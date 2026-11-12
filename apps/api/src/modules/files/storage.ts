import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { badRequest } from "../../lib/errors.js";
import type { TenantDb } from "../../db/pool.js";

export type FileKind = "logo" | "item_image" | "document" | "employee_doc" | "pdf" | "payslip" | "import" | "export" | "backup" | "attachment";

/** What may be uploaded where, and how big. Checked by the file's real bytes, not its name. */
export const UPLOAD_RULES: Record<string, { maxBytes: number; types: string[] }> = {
  logo: { maxBytes: 1 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  item_image: { maxBytes: 2 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp"] },
  document: { maxBytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
  employee_doc: { maxBytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
  attachment: { maxBytes: 5 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "application/pdf"] },
  import: { maxBytes: 5 * 1024 * 1024, types: ["text/csv"] },
};
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf",
  "text/csv": "csv", "application/gzip": "gz", "application/octet-stream": "bin",
};

/** Detects the real type from the first bytes ("magic numbers"). SVG/HTML are never accepted. */
export function sniffType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buf.length >= 5 && buf.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function looksLikeCsv(buf: Buffer): boolean {
  const head = buf.subarray(0, 4096).toString("utf8");
  return !head.includes("\u0000") && !/<\s*(script|html|svg)/i.test(head) && head.includes(",");
}

export function storageRoot(): string {
  return path.resolve(env().STORAGE_DIR);
}

/** Full disk path for a stored relative path; refuses anything that escapes STORAGE_DIR. */
export function diskPath(relative: string): string {
  const root = storageRoot();
  const full = path.resolve(root, relative);
  if (!full.startsWith(root + path.sep)) throw new Error("Invalid storage path");
  return full;
}

function relPath(tenantId: number, kind: string, mime: string): string {
  const now = new Date();
  const name = `${randomBytes(16).toString("hex")}.${EXT[mime] ?? "bin"}`;
  return path.posix.join(`t_${tenantId}`, kind, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"), name);
}

/** Validates an upload against UPLOAD_RULES and returns its real MIME type. */
export function validateUpload(kind: string, buf: Buffer): string {
  const rule = UPLOAD_RULES[kind];
  if (!rule) throw badRequest("invalid_file_kind", "This kind of upload is not allowed.");
  if (buf.length === 0) throw badRequest("empty_file", "The file is empty.");
  if (buf.length > rule.maxBytes) throw badRequest("file_too_large", `File is too large. Maximum is ${Math.round(rule.maxBytes / 1024 / 1024)} MB.`);
  const mime = kind === "import" ? (looksLikeCsv(buf) ? "text/csv" : null) : sniffType(buf);
  if (!mime || !rule.types.includes(mime)) throw badRequest("invalid_file_type", `Allowed: ${rule.types.map((t) => EXT[t]).join(", ")}.`);
  return mime;
}

/** Writes bytes to the tenant's folder and records them in `files`. Atomic write (tmp + rename). */
export async function saveFile(
  tdb: TenantDb,
  o: { kind: FileKind; buffer: Buffer; mime: string; originalName: string; createdBy: number | null },
): Promise<{ id: number; storagePath: string }> {
  const rel = relPath(tdb.tenantId, o.kind, o.mime);
  const full = diskPath(rel);
  await mkdir(path.dirname(full), { recursive: true, mode: 0o750 });
  const tmp = `${full}.tmp`;
  await writeFile(tmp, o.buffer, { mode: 0o640 });
  await rename(tmp, full);
  const safeName = o.originalName.replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "file";
  try {
    const r = await tdb.exec(
      `INSERT INTO files (tenant_id, kind, storage_path, original_name, mime_type, size_bytes, sha256, created_by)
       VALUES (:tenantId, :kind, :path, :name, :mime, :size, :sha, :by)`,
      { kind: o.kind, path: rel, name: safeName, mime: o.mime, size: o.buffer.length, sha: createHash("sha256").update(o.buffer).digest("hex"), by: o.createdBy },
    );
    return { id: r.insertId, storagePath: rel };
  } catch (e) {
    await unlink(full).catch(() => {});
    throw e;
  }
}

export async function readStoredFile(rel: string): Promise<Buffer> {
  return readFile(diskPath(rel));
}
