import { useCallback, useEffect, useState } from "react";
import { get, getTenantId } from "./api";

/** Loads data from the API; `reload()` fetches again. */
export function useLoad<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path));
      setError("");
    } catch (e: any) {
      setError(e?.message ?? "Could not load.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, reload, setData };
}

/** Downloads a server-made PDF (sent with the same sign-in and business as API calls). */
export async function downloadPdf(path: string, filename: string) {
  const headers: Record<string, string> = {};
  const tid = getTenantId();
  if (tid) headers["X-Tenant-Id"] = tid;
  const res = await fetch(`/api/v1${path}`, { credentials: "same-origin", headers });
  if (!res.ok) throw new Error("Could not create the PDF. Please try again.");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename.replace(/[^\w.-]+/g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
