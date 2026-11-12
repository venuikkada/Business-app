import bcrypt from "bcryptjs";
import { badRequest } from "../../lib/errors.js";

const COST = 12;
// Used when the account does not exist, so a wrong email takes as long as a wrong password.
let dummyHash: string | null = null;
const dummy = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password-0", COST));

const COMMON = new Set([
  "password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "iloveyou", "india123",
  "admin123", "welcome1", "abc12345", "11111111", "00000000", "passw0rd", "letmein1", "sunshine",
]);

export function checkPasswordStrength(pw: string): void {
  if (pw.length < 8) throw badRequest("weak_password", "Password must be at least 8 characters.");
  if (pw.length > 72) throw badRequest("weak_password", "Password must be at most 72 characters.");
  if (COMMON.has(pw.toLowerCase())) throw badRequest("weak_password", "This password is too common. Choose another.");
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw badRequest("weak_password", "Use letters and numbers in your password.");
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, COST);

export async function verifyPassword(pw: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(pw, hash ?? dummy());
  return ok && hash !== null;
}
