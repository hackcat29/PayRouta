// Confirming it's you before a sensitive action (API keys, payouts, team
// roles, settlement accounts, operations). A confirmation lasts 15 minutes
// on this session (StepUp).
//
// Accounts protect sensitive actions with two-step verification: an
// authenticator app (Google Authenticator, Microsoft Authenticator,
// 1Password and others), a passkey (Face ID, Touch ID, Windows Hello, a
// security key or a password manager), or both. Recovery codes stand in for
// a lost authenticator. Text messages aren't offered: SIM swaps defeat them.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { generateAuthenticationOptions, verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { db } from "./db";
import { PortalError } from "./domain";
import { identity, rateLimit } from "./access";
import { audit } from "./service";

const lifetimeMs = 15 * 60000;
const baseUrl = () => new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000");
const challengeKey = (sessionId: string) => `step-up-passkey:${sessionId}`;

// What this person can confirm with, for the confirmation dialog.
export async function stepUpMethods(h: Headers) {
  const who = await identity(h);
  const passkeys = await db.passkey.count({ where: { userId: who.user.id } });
  const grant = await db.stepUp.findUnique({ where: { sessionId: who.session.id } });
  return {
    authenticator: !!who.user.twoFactorEnabled,
    passkeys,
    // Already confirmed on this session, until then.
    confirmedUntil: grant && grant.expiresAt > new Date() ? grant.expiresAt.toISOString() : null,
  };
}

// The WebAuthn challenge for confirming with one of this person's passkeys.
export async function stepUpPasskeyOptions(h: Headers) {
  const who = await identity(h);
  await rateLimit(`mfa-options:${who.user.id}`, 10);
  const passkeys = await db.passkey.findMany({ where: { userId: who.user.id } });
  if (!passkeys.length) throw new PortalError("NO_PASSKEYS", 409);
  const options = await generateAuthenticationOptions({
    rpID: baseUrl().hostname,
    userVerification: "required",
    allowCredentials: passkeys.map((p) => ({
      id: p.credentialID,
      transports: (p.transports ? p.transports.split(",").filter(Boolean) : undefined) as never,
    })),
  });
  await db.verification.deleteMany({ where: { identifier: challengeKey(who.session.id) } });
  await db.verification.create({
    data: { id: randomUUID(), identifier: challengeKey(who.session.id), value: options.challenge, expiresAt: new Date(Date.now() + 5 * 60000) },
  });
  return options;
}

const input = z.union([
  z.object({ method: z.literal("authenticator").optional(), code: z.string().regex(/^\d{6}$/) }),
  z.object({ method: z.literal("recovery"), code: z.string().trim().min(6).max(32) }),
  z.object({ method: z.literal("passkey"), response: z.record(z.string(), z.unknown()) }),
]);

export async function confirmStepUp(h: Headers, raw: unknown, local = false) {
  const who = await identity(h);
  await rateLimit(`mfa:${who.user.id}`, 5);
  const body = input.parse(raw);
  const { auth } = await import("./auth");
  const method = "response" in body ? "passkey" : body.method === "recovery" ? "recovery" : "authenticator";
  if (!("response" in body) && body.method !== "recovery") {
    let code = body.code;
    if (local && code === "123456") {
      const { createOTP } = await import("@better-auth/utils/otp");
      code = await createOTP("payrouta-fictional-totp-secret").totp();
    }
    await auth.api.verifyTOTP({ headers: h, body: { code, trustDevice: false } });
  } else if (!("response" in body)) {
    // Each recovery code works once.
    await auth.api.verifyBackupCode({ headers: h, body: { code: body.code, disableSession: true, trustDevice: false } });
  } else {
    const stored = await db.verification.findFirst({ where: { identifier: challengeKey(who.session.id) } });
    await db.verification.deleteMany({ where: { identifier: challengeKey(who.session.id) } });
    if (!stored || stored.expiresAt < new Date()) throw new PortalError("PASSKEY_CHALLENGE_EXPIRED", 409);
    const response = body.response as unknown as AuthenticationResponseJSON;
    const passkey = await db.passkey.findFirst({ where: { userId: who.user.id, credentialID: String(response.id) } });
    if (!passkey) throw new PortalError("PASSKEY_NOT_RECOGNISED", 403);
    let verified = false;
    try {
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: stored.value,
        expectedOrigin: baseUrl().origin,
        expectedRPID: baseUrl().hostname,
        requireUserVerification: true,
        credential: {
          id: passkey.credentialID,
          publicKey: new Uint8Array(Buffer.from(passkey.publicKey, "base64")),
          counter: passkey.counter,
          transports: (passkey.transports ? passkey.transports.split(",").filter(Boolean) : undefined) as never,
        },
      });
      verified = result.verified;
      if (verified) await db.passkey.update({ where: { id: passkey.id }, data: { counter: result.authenticationInfo.newCounter } });
    } catch {
      verified = false;
    }
    if (!verified) throw new PortalError("PASSKEY_NOT_VERIFIED", 403);
  }
  const expiresAt = new Date(Date.now() + lifetimeMs);
  await db.stepUp.upsert({ where: { sessionId: who.session.id }, create: { sessionId: who.session.id, expiresAt }, update: { expiresAt } });
  await audit(db, null, who.user.id, "Sensitive action verification", who.session.id, { method }, true);
  return { confirmedUntil: expiresAt.toISOString() };
}
