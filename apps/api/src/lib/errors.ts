/** An error that is safe to show to the user. `code` is translated by the app. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (code = "unauthorized", message = "Please sign in again.") => new AppError(401, code, message);
export const forbidden = (code = "forbidden", message = "You do not have permission to do this.") => new AppError(403, code, message);
export const notFound = (what = "Record") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const tooMany = (retryAfterSec: number, message = "Too many attempts. Please wait and try again.") =>
  new AppError(429, "rate_limited", message, { retryAfter: retryAfterSec }, { "Retry-After": String(retryAfterSec) });
