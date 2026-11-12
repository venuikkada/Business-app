/** Fetch wrapper: cookies, CSRF header, open business per tab, silent token refresh. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: any,
  ) {
    super(message);
  }
}

let csrf: string | null = null;
let refreshing: Promise<boolean> | null = null;
const listeners = new Set<() => void>();

/** Called when the session is gone (refresh failed) so the app can show the login page. */
export function onSignedOut(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const TENANT_KEY = "cb.tenantId";
export function getTenantId(): string | null {
  return sessionStorage.getItem(TENANT_KEY) ?? localStorage.getItem(TENANT_KEY);
}
export function setTenantId(id: number | null) {
  if (id == null) {
    sessionStorage.removeItem(TENANT_KEY);
    localStorage.removeItem(TENANT_KEY);
  } else {
    sessionStorage.setItem(TENANT_KEY, String(id));
    localStorage.setItem(TENANT_KEY, String(id));
  }
}

async function getCsrf(force = false): Promise<string> {
  if (!csrf || force) {
    const r = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
    csrf = (await r.json()).data.csrfToken as string;
  }
  return csrf;
}

async function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const r = await fetch("/api/v1/auth/refresh", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": await getCsrf() },
      });
      return r.ok;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export async function api<T = any>(method: Method, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = await getCsrf();
  const tid = getTenantId();
  if (tid) headers["X-Tenant-Id"] = tid;

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "No internet connection.");
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json.data as T;

  const err = json.error ?? {};
  if (retry && res.status === 401 && ["token_expired", "invalid_token", "no_session"].includes(err.code)) {
    if (await refreshSession()) return api<T>(method, path, body, false);
    listeners.forEach((l) => l());
  }
  if (retry && res.status === 403 && err.code === "csrf_failed") {
    await getCsrf(true);
    return api<T>(method, path, body, false);
  }
  if (res.status === 401 && err.code === "session_revoked") listeners.forEach((l) => l());
  throw new ApiError(res.status, err.code ?? "error", err.message ?? "Something went wrong.", err.details);
}

export const get = <T = any>(p: string) => api<T>("GET", p);
export const post = <T = any>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>("PATCH", p, b ?? {});
export const del = <T = any>(p: string) => api<T>("DELETE", p);
