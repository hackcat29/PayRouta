import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { captcha, emailOTP, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { db } from "./db";
import { mail } from "./adapters";
import {
  renderOneTimeCodeEmail,
  renderPasswordChangedEmail,
  renderResetPasswordEmail,
  renderVerifyEmail,
} from "@/lib/email/templates/transactional";

const HOUR = 60 * 60;
const CODE_MINUTES = 10;
const baseUrl = new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000");

// Google sign-in is offered only when its OAuth client is configured.
export const googleEnabled = () =>
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const auth = betterAuth({
  appName: "PayRouta",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: HOUR,
    // A reset signs the account out everywhere, in case the old password leaked.
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url, token }) => {
      await mail.send(user.email, {
        ...renderResetPasswordEmail({ name: user.name, url }),
        tag: "reset_password",
        idempotencyKey: `reset-password/${token}`,
      });
    },
    onPasswordReset: async ({ user }) => {
      // Best effort: the reset itself has already succeeded.
      await mail
        .send(user.email, {
          ...renderPasswordChangedEmail({
            name: user.name,
            when: new Date(),
            signInUrl: `${process.env.BETTER_AUTH_URL}/sign-in`,
          }),
          tag: "password_changed",
        })
        .catch((e) =>
          console.error(
            "[auth] password-changed email",
            e instanceof Error ? e.message : e,
          ),
        );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Signing in before verifying sends a fresh link instead of a dead end.
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: HOUR,
    sendVerificationEmail: async ({ user, url, token }) => {
      await mail.send(user.email, {
        ...renderVerifyEmail({ name: user.name, url }),
        tag: "verify_email",
        idempotencyKey: `verify-email/${token}`,
      });
    },
  },
  socialProviders: googleEnabled()
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  account: {
    accountLinking: {
      enabled: true,
      // Google confirms email ownership, so a Google sign-in may join an
      // existing account with the same email. requireLocalEmailVerified
      // (the default) stops it joining an account nobody has confirmed, which
      // would otherwise let someone pre-register a victim's email.
      trustedProviders: ["google"],
    },
  },
  session: {
    expiresIn: 8 * HOUR,
    updateAge: HOUR,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 40,
    // Tighter limits where guessing or mail-bombing is possible.
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
      "/request-password-reset": { window: 300, max: 3 },
      "/send-verification-email": { window: 300, max: 3 },
      "/two-factor/verify-totp": { window: 60, max: 5 },
      "/two-factor/verify-backup-code": { window: 60, max: 5 },
      "/email-otp/send-verification-otp": { window: 300, max: 3 },
      "/sign-in/email-otp": { window: 60, max: 5 },
      "/passkey/verify-authentication": { window: 60, max: 10 },
      "/sign-in/sso": { window: 60, max: 10 },
    },
  },
  hooks: {
    // A one-time code alone would bypass an authenticator app, so accounts
    // with two-step verification use their password (then the app) or a
    // passkey instead. The answer only reaches someone who received the code.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/email-otp") return;
      const email = String(
        (ctx.body as { email?: unknown })?.email ?? "",
      ).toLowerCase();
      const user = email
        ? await db.user.findUnique({
            where: { email },
            select: { twoFactorEnabled: true },
          })
        : null;
      if (user?.twoFactorEnabled)
        throw new APIError("FORBIDDEN", {
          message:
            "This account uses two-step verification. Sign in with your password or a passkey.",
          code: "TWO_FACTOR_REQUIRED",
        });
    }),
  },
  advanced: {
    // Set by our nginx proxy from the connecting address (deploy/payrouta-proxy.conf).
    ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.PORTAL_MODE !== "local",
    },
  },
  plugins: [
    // Bot check on sign-up, sign-in and the routes that send email. The
    // browser sends Turnstile's token in the x-captcha-response header.
    // Enforced once TURNSTILE_SECRET_KEY is set (lib/turnstile.ts); until
    // then no route matches, so nothing is checked.
    captcha({
      provider: "cloudflare-turnstile",
      secretKey: process.env.TURNSTILE_SECRET_KEY ?? "",
      endpoints: process.env.TURNSTILE_SECRET_KEY
        ? [
            "/sign-up/email",
            "/sign-in/email",
            "/request-password-reset",
            "/email-otp/send-verification-otp",
          ]
        : ["/captcha-not-configured"],
    }),
    twoFactor({ issuer: "PayRouta" }),
    // Passwordless sign-in with a code by email. Sign-up still goes through
    // the normal form, so a code can't create an account on its own.
    emailOTP({
      otpLength: 6,
      expiresIn: CODE_MINUTES * 60,
      allowedAttempts: 3,
      disableSignUp: true,
      storeOTP: "hashed",
      sendVerificationOTP: async ({ email, otp, type }) => {
        await mail.send(email, {
          ...renderOneTimeCodeEmail({ code: otp, type, minutes: CODE_MINUTES }),
          tag: `otp_${type.replace(/-/g, "_")}`,
        });
      },
    }),
    // WebAuthn passkeys: Face ID, Touch ID, Windows Hello, security keys.
    passkey({
      rpID: baseUrl.hostname,
      rpName: "PayRouta",
      origin: baseUrl.origin,
    }),
    // Company single sign-on. Each merchant registers its own SAML or OIDC
    // identity provider for a domain it proves it owns with a DNS TXT record;
    // registration is limited to organisation owners and admins in
    // app/api/auth/[...all]/route.ts.
    sso({
      providersLimit: 5,
      domainVerification: { enabled: true, tokenPrefix: "payrouta-verify" },
      provisionUser: async ({ user, provider }) => {
        await provisionSsoMember(user, provider);
      },
      provisionUserOnEveryLogin: true,
    }),
  ],
});

// People who sign in through a company's identity provider join that
// company's PayRouta organisation as read-only analysts; an owner can raise
// their role. Their email is confirmed because the company proved it owns the
// domain.
async function provisionSsoMember(
  user: { id: string; email: string; emailVerified?: boolean },
  provider: {
    organizationId?: string | null;
    domain: string;
    domainVerified?: boolean | null;
  },
) {
  const emailDomain = user.email.split("@")[1]?.toLowerCase() ?? "";
  const domain = provider.domain.toLowerCase();
  const ownDomain =
    emailDomain === domain || emailDomain.endsWith(`.${domain}`);
  if (provider.domainVerified && ownDomain && !user.emailVerified)
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: true },
    });
  if (!provider.organizationId || !ownDomain) return;
  const org = await db.organization.findUnique({
    where: { id: provider.organizationId },
    select: { id: true },
  });
  if (!org) return;
  await db.membership.upsert({
    where: { orgId_userId: { orgId: org.id, userId: user.id } },
    create: {
      orgId: org.id,
      userId: user.id,
      role: "None",
      merchantRole: "Analyst",
    },
    update: {},
  });
}
