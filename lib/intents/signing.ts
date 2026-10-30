// Signature formats NEAR Intents accepts (1Click OpenAPI, MultiPayload).
// Browser-safe: the merchant dashboard uses these to turn a wallet's answer
// into the signed payload 1Click submits, and the server to check it.
//
//   nep413  NEAR wallets (signMessage). Signature and key are base58 with an
//           `ed25519:` prefix; wallets usually return the signature in base64.
//   erc191  EVM wallets (personal_sign). Signature is r||s||v in base58 with
//           a `secp256k1:` prefix, v normalised to 0 or 1.
import bs58 from "bs58";

export type Nep413Payload = { message: string; nonce: string; recipient: string; callbackUrl?: string | null };
export type SignedIntent =
  | { standard: "nep413"; payload: Nep413Payload; public_key: string; signature: string }
  | { standard: "erc191"; payload: string; signature: string };

const fromBase64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export function ed25519Signature(signature: string) {
  if (signature.startsWith("ed25519:")) return signature;
  // 64 bytes in padded base64 always end "=="; base58 never has padding but
  // can be 88 characters too.
  const bytes = /^[A-Za-z0-9+/]{86}==$/.test(signature) ? fromBase64(signature) : bs58.decode(signature);
  if (bytes.length !== 64) throw new Error("Unexpected signature from the wallet.");
  return `ed25519:${bs58.encode(bytes)}`;
}

export function secp256k1Signature(hex: string) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(hex)) throw new Error("Unexpected signature from the wallet.");
  const bytes = Uint8Array.from(hex.slice(2).match(/../g)!.map((b) => parseInt(b, 16)));
  if (bytes[64] >= 27) bytes[64] -= 27;
  if (bytes[64] > 1) throw new Error("Unexpected signature from the wallet.");
  return `secp256k1:${bs58.encode(bytes)}`;
}

export function nonceBytes(nonce: string) {
  const bytes = fromBase64(nonce);
  if (bytes.length !== 32) throw new Error("Unexpected signing request.");
  return bytes;
}
