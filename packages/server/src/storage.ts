import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { AppError } from "./errors";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const SIGNATURES: Array<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
];

/**
 * Detects the real file type from its bytes (never trust the client's
 * Content-Type or file name). Only images and PDFs are accepted.
 */
export function sniff(buf: Buffer, allowed: string[]): { mime: string; ext: string } {
  if (buf.length === 0) throw new AppError("VALIDATION", "The file is empty");
  if (buf.length > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "Files must be 5 MB or smaller");
  const s = SIGNATURES.find((x) => x.test(buf));
  if (!s || !allowed.includes(s.mime)) throw new AppError("VALIDATION", `Unsupported file type. Allowed: ${allowed.map((m) => m.split("/")[1]).join(", ")}`);
  return { mime: s.mime, ext: s.ext };
}

export interface StorageDriver {
  put(key: string, data: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalDriver implements StorageDriver {
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async remove(key: string) {
    await unlink(this.resolve(key)).catch(() => undefined);
  }
}

/**
 * S3-compatible object storage (AWS S3, Cloudflare R2, Supabase Storage S3
 * endpoint, MinIO). Requires `@aws-sdk/client-s3` to be installed in the
 * host app. Buckets must be private; files are only served through the API
 * after a tenant permission check.
 */
class S3Driver implements StorageDriver {
  private client: Promise<{ send: (c: unknown) => Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }>; mod: Record<string, new (i: unknown) => unknown> }>;
  constructor(private bucket: string) {
    const modName = "@aws-sdk/client-s3";
    this.client = import(/* webpackIgnore: true */ modName).then((mod: Record<string, unknown>) => {
      const S3Client = mod.S3Client as new (o: unknown) => { send: (c: unknown) => Promise<{ Body?: { transformToByteArray(): Promise<Uint8Array> } }> };
      const c = new S3Client({
        region: process.env.S3_REGION ?? "auto",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: !!process.env.S3_ENDPOINT,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" },
      });
      return { send: (cmd: unknown) => c.send(cmd), mod: mod as Record<string, new (i: unknown) => unknown> };
    });
  }
  async put(key: string, data: Buffer, mime: string) {
    const { send, mod } = await this.client;
    await send(new mod.PutObjectCommand!({ Bucket: this.bucket, Key: key, Body: data, ContentType: mime, ServerSideEncryption: process.env.S3_SSE || undefined }));
  }
  async get(key: string) {
    const { send, mod } = await this.client;
    const r = await send(new mod.GetObjectCommand!({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async remove(key: string) {
    const { send, mod } = await this.client;
    await send(new mod.DeleteObjectCommand!({ Bucket: this.bucket, Key: key }));
  }
}

let driver: StorageDriver | null = null;
export function storage(): StorageDriver {
  if (!driver) driver = env.storageDriver === "s3" ? new S3Driver(process.env.S3_BUCKET ?? "") : new LocalDriver(path.resolve(env.storageLocalDir));
  return driver;
}

export function newStorageKey(businessId: string, ext: string) {
  return `${businessId}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}.${ext}`;
}

export function sha256Hex(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}
