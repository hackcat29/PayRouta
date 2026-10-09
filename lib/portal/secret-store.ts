// Production secret store: envelope encryption in PostgreSQL.
//
// Each secret is AES-256-GCM encrypted under a master key identified by a key
// ID; the ciphertext's own reference is bound as additional authenticated data,
// so ciphertext cannot be swapped between references. Master keys never touch
// the database: they come from SECRET_MASTER_KEYS ("id:base64,id:base64"),
// and SECRET_ACTIVE_KEY_ID selects the key for new secrets. A database dump or
// backup alone therefore reveals no secret. Rotate by adding a new key, making
// it active, running `npm run secrets:rotate`, then removing the old key.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { db } from "./db";
import { PortalError } from "./domain";

type Keyring = { active: string; keys: Map<string, Buffer> };

export function parseKeyring(raw = process.env.SECRET_MASTER_KEYS, active = process.env.SECRET_ACTIVE_KEY_ID): Keyring | null {
  if (!raw) return null;
  const keys = new Map<string, Buffer>();
  for (const entry of raw.split(",").map((e) => e.trim()).filter(Boolean)) {
    const [id, value] = entry.split(":");
    if (!id || !/^[a-z0-9-]{1,40}$/.test(id) || !value)
      throw new PortalError("SECRET_MASTER_KEYS is malformed", 503);
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new PortalError(`Master key ${id} must be 32 bytes`, 503);
    keys.set(id, key);
  }
  const chosen = active || [...keys.keys()][0];
  if (!chosen || !keys.has(chosen)) throw new PortalError("SECRET_ACTIVE_KEY_ID is not in the keyring", 503);
  return { active: chosen, keys };
}

function keyring() {
  const ring = parseKeyring();
  if (!ring) throw new PortalError("Managed secret service is not configured", 503);
  return ring;
}

function seal(key: Buffer, ref: string, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(ref));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function open(key: Buffer, ref: string, iv: Uint8Array, tag: Uint8Array, ciphertext: Uint8Array) {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv));
  decipher.setAAD(Buffer.from(ref));
  decipher.setAuthTag(Buffer.from(tag));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]).toString("utf8");
}

function validRef(ref: string) {
  if (!/^[a-f0-9-]{36}$/.test(ref)) throw new PortalError("Invalid secret reference");
  return ref;
}

export const databaseSecretStore = {
  backend: "database-envelope",
  async put(value: string) {
    const ring = keyring();
    const id = randomUUID();
    const sealed = seal(ring.keys.get(ring.active)!, id, value);
    await db.secret.create({
      data: {
        id,
        keyId: ring.active,
        iv: sealed.iv,
        tag: sealed.tag,
        ciphertext: sealed.ciphertext,
      },
    });
    return id;
  },
  async get(ref: string) {
    const row = await db.secret.findUnique({ where: { id: validRef(ref) } });
    if (!row?.ciphertext) throw new PortalError("Secret is unavailable or revoked", 404);
    const key = keyring().keys.get(row.keyId);
    if (!key) throw new PortalError(`Master key ${row.keyId} is not loaded`, 503);
    try {
      return open(key, row.id, row.iv, row.tag, row.ciphertext);
    } catch {
      throw new PortalError("Secret failed integrity check", 503);
    }
  },
  async revoke(ref: string) {
    await db.secret.updateMany({
      where: { id: validRef(ref), revokedAt: null },
      data: { ciphertext: null, revokedAt: new Date() },
    });
  },
};

// Re-encrypt every live secret under the active key. Safe to re-run.
export async function rotateSecrets() {
  const ring = keyring();
  let rotated = 0;
  for (;;) {
    const rows = await db.secret.findMany({
      where: { keyId: { not: ring.active }, revokedAt: null },
      take: 100,
    });
    if (!rows.length) return rotated;
    for (const row of rows) {
      const key = ring.keys.get(row.keyId);
      if (!key) throw new PortalError(`Master key ${row.keyId} is not loaded; cannot rotate`, 503);
      const value = open(key, row.id, row.iv, row.tag, row.ciphertext!);
      const sealed = seal(ring.keys.get(ring.active)!, row.id, value);
      await db.secret.update({
        where: { id: row.id },
        data: { keyId: ring.active, ...sealed, rotatedAt: new Date() },
      });
      rotated++;
    }
  }
}
