import { listQuerySchema } from "@cba/core";
import type { z } from "zod";

export type ListQuery = z.infer<typeof listQuerySchema>;

const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** snake_case DB rows → camelCase API objects (recursively for json columns). */
export function camelize<T = Record<string, unknown>>(v: unknown): T {
  if (Array.isArray(v)) return v.map((x) => camelize(x)) as T;
  if (v && typeof v === "object" && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [camel(k), camelize(x)])) as T;
  }
  return v as T;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function parseList(q: unknown): ListQuery {
  return listQuerySchema.parse(q ?? {});
}

/** Pick an ORDER BY column from an allow-list (never interpolate user input). */
export function orderBy(sort: string | undefined, allowed: Record<string, string>, fallback: string, dir: "asc" | "desc") {
  const col = (sort && allowed[sort]) || allowed[fallback] || fallback;
  return `${col} ${dir === "asc" ? "asc" : "desc"} nulls last`;
}

/** Escapes LIKE wildcards in user search input. */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function addressFrom(prefix: string, row: Record<string, unknown>) {
  return {
    line1: (row[`${prefix}_line1`] as string) ?? null,
    line2: (row[`${prefix}_line2`] as string) ?? null,
    city: (row[`${prefix}_city`] as string) ?? null,
    stateCode: (row[`${prefix}_state_code`] as string) ?? null,
    pincode: (row[`${prefix}_pincode`] as string) ?? null,
  };
}
