// Server-side checks of NEAR Intents signatures (lib/intents/signing.ts):
// who signed a NEP-413 or ERC-191 message. Used to prove a merchant controls
// the intents account their crypto checkouts settle into.
import { createHash, createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { Nep413Payload } from "./signing";

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const text = (s: string) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};

// NEP-413: sha256 of the Borsh-serialised payload behind the 2^31 + 413 tag.
export function nep413Hash(p: Nep413Payload) {
  const nonce = Buffer.from(p.nonce, "base64");
  if (nonce.length !== 32) throw new Error("NEP-413 nonce must be 32 bytes");
  return createHash("sha256")
    .update(
      Buffer.concat([
        u32(2 ** 31 + 413),
        text(p.message),
        nonce,
        text(p.recipient),
        p.callbackUrl ? Buffer.concat([Buffer.from([1]), text(p.callbackUrl)]) : Buffer.from([0]),
      ]),
    )
    .digest();
}

const spki = Buffer.from("302a300506032b6570032100", "hex");
export function verifyNep413(p: Nep413Payload, publicKey: string, signature: string) {
  if (!publicKey.startsWith("ed25519:") || !signature.startsWith("ed25519:")) return false;
  try {
    const key = Buffer.from(bs58.decode(publicKey.slice(8)));
    const sig = Buffer.from(bs58.decode(signature.slice(8)));
    if (key.length !== 32 || sig.length !== 64) return false;
    return verify(null, nep413Hash(p), createPublicKey({ key: Buffer.concat([spki, key]), format: "der", type: "spki" }), sig);
  } catch {
    return false;
  }
}

// raw_ed25519 (Solana wallets): an ed25519 signature over the message's
// UTF-8 bytes themselves.
export function verifyRawEd25519(message: string, publicKey: string, signature: string) {
  if (!publicKey.startsWith("ed25519:") || !signature.startsWith("ed25519:")) return false;
  try {
    const key = Buffer.from(bs58.decode(publicKey.slice(8)));
    const sig = Buffer.from(bs58.decode(signature.slice(8)));
    if (key.length !== 32 || sig.length !== 64) return false;
    return verify(null, Buffer.from(message, "utf8"), createPublicKey({ key: Buffer.concat([spki, key]), format: "der", type: "spki" }), sig);
  } catch {
    return false;
  }
}

// The lowercase EVM address that personal_sign-ed `message`, or null.
export function erc191Signer(message: string, signature: string) {
  if (!signature.startsWith("secp256k1:")) return null;
  try {
    const sig = bs58.decode(signature.slice(10));
    if (sig.length !== 65 || sig[64] > 1) return null;
    const body = new TextEncoder().encode(message);
    const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`), body]));
    const point = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(sig[64]).recoverPublicKey(digest);
    return `0x${Buffer.from(keccak_256(point.toRawBytes(false).slice(1)).slice(-20)).toString("hex")}`;
  } catch {
    return null;
  }
}
