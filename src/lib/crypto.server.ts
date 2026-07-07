// AES-256-GCM helpers for encrypting integration credentials.
// Only imported by *.server.ts modules or dynamically inside server fn handlers.
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

function getKey(): Buffer {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  // Normalize any length input to a 32-byte key via SHA-256.
  return createHash("sha256").update(raw).digest();
}

export function encryptString(plain: string): string {
  if (!plain) return "";
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  });
}

export function decryptString(blob: string | null | undefined): string {
  if (!blob) return "";
  const { iv, ct, tag } = JSON.parse(blob);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]);
  return out.toString("utf8");
}