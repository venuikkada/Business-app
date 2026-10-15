import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../env";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// scrypt parameters (N=2^15, r=8, p=1) ≈ 32 MiB memory per hash.
const N = 1 << 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

/** Hash format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A dummy hash so failed lookups take as long as real verifications. */
let dummyHash: string | null = null;
export async function burnPasswordCheck(password: string) {
  dummyHash ??= await hashPassword("dummy-password-for-timing");
  await verifyPassword(password, dummyHash);
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): Buffer {
  return createHash("sha256").update(input).digest();
}

function key(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", env.appSecret, "cba-salt", purpose, 32));
}

/** AES-256-GCM encryption for secrets at rest (e.g. TOTP seeds). */
export function encryptSecret(plain: string, purpose = "totp"): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(purpose), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(blob: string, purpose = "totp"): string {
  const [v, ivB, tagB, encB] = blob.split(".");
  if (v !== "v1" || !ivB || !tagB || !encB) throw new Error("Unsupported secret format");
  const d = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(ivB, "base64url"));
  d.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([d.update(Buffer.from(encB, "base64url")), d.final()]).toString("utf8");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
