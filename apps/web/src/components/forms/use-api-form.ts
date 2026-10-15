"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api-client";

/** Tracks busy state, a top-level error and per-field errors from API validation issues. */
export function useApiForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const issues = (e.details?.issues ?? []) as Array<{ path: string; message: string }>;
        setFields(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        if (e.details?.field) setFields((f) => ({ ...f, [String(e.details!.field)]: e.message }));
        throw e;
      }
      setError("Network problem. Please try again.");
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, run, setError };
}
