import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const hmac = (secret: string, s: string) => createHmac("sha256", secret).update(s).digest("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const requestId = () => randomBytes(8).toString("hex");

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** 6-digit OTP from a cryptographically secure source. */
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * AES-256-GCM with DATA_ENCRYPTION_KEY. Output: "v1:" + base64(iv | tag | ciphertext).
 * Used for backups and sensitive columns (bank account numbers, integration keys).
 */
export function encrypt(plain: Buffer | string): string {
  return "v1:" + encryptBuffer(Buffer.isBuffer(plain) ? plain : Buffer.from(plain, "utf8")).toString("base64");
}

export function decrypt(token: string): Buffer {
  if (!token.startsWith("v1:")) throw new Error("Unknown ciphertext version");
  return decryptBuffer(Buffer.from(token.slice(3), "base64"));
}

export function encryptBuffer(plain: Buffer, keyHex = env().DATA_ENCRYPTION_KEY): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptBuffer(data: Buffer, keyHex = env().DATA_ENCRYPTION_KEY): Buffer {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]);
}
