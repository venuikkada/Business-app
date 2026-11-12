import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { isProd } from "../config/env.js";
import { AppError } from "../lib/errors.js";

/** One error format for the whole API: { error: { code, message, details?, requestId } } */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as any).requestId;
  if (res.headersSent) return;
  if (err instanceof AppError) {
    if (err.headers) for (const [k, v] of Object.entries(err.headers)) res.setHeader(k, v);
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details, requestId } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "validation_failed",
        message: "Please check the highlighted fields.",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        requestId,
      },
    });
    return;
  }
  const e = err as any;
  if (e?.type === "entity.too.large") {
    res.status(413).json({ error: { code: "payload_too_large", message: "Request is too large.", requestId } });
    return;
  }
  if (e?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Request body is not valid JSON.", requestId } });
    return;
  }
  if (e?.code === "ER_DUP_ENTRY") {
    res.status(409).json({ error: { code: "duplicate", message: "This record already exists.", requestId } });
    return;
  }
  if (e?.code === "ER_NO_REFERENCED_ROW_2" || e?.code === "ER_ROW_IS_REFERENCED_2") {
    res.status(409).json({ error: { code: "invalid_reference", message: "This links to a record that does not exist or is still in use.", requestId } });
    return;
  }
  console.error(JSON.stringify({ level: "error", requestId, path: req.path, message: e?.message, stack: isProd() ? undefined : e?.stack }));
  res.status(500).json({ error: { code: "server_error", message: "Something went wrong. Please try again.", requestId } });
}
