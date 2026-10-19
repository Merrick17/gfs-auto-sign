import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { requireEnv } from "./env";

// AES-256-GCM envelope for certificate material at rest. Layout: iv(12) | tag(16) | ciphertext.
const key = () => {
  const k = Buffer.from(requireEnv("CERT_ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("CERT_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return k;
};

export function seal(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

export function open(sealed: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key(), sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}
