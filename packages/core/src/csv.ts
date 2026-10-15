/**
 * Minimal RFC 4180 CSV parser/serialiser (quotes, escaped quotes, CRLF).
 * Kept dependency-free so it runs identically in the browser and on the server.
 */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** Parses CSV into objects keyed by normalised header names (lower_snake). */
export function parseCSVObjects(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const all = parseCSV(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const headers = all[0]!.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
  const rows = all.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
  return { headers, rows };
}

function escapeField(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Prevent CSV/formula injection when the file is opened in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
