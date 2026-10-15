"use client";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public details?: Record<string, unknown>) {
    super(message);
  }
}

/** Fetch wrapper for /api/v1 from the browser. Sends the CSRF header and parses errors. */
export async function api<T = unknown>(method: string, path: string, body?: unknown, opts: { idempotencyKey?: string } = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`/api/v1/${path.replace(/^\//, "")}`, {
    method,
    headers: {
      "x-cba-csrf": "1",
      ...(isForm || body === undefined ? {} : { "content-type": "application/json" }),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(err.code ?? "INTERNAL", err.message ?? `Request failed (${res.status})`, res.status, err.details);
  }
  return data as T;
}

export function newIdempotencyKey() {
  return `web-${crypto.randomUUID()}`;
}
