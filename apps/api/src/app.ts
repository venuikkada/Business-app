import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import { COOKIE_CSRF } from "./http/auth-middleware.js";
import { errorHandler } from "./http/errors.js";
import { memoryLimit } from "./http/rate-limit.js";
import { requestId } from "./lib/crypto.js";
import { safeEqual } from "./lib/crypto.js";
import { accountRoutes } from "./modules/account/routes.js";
import { auditRoutes } from "./modules/audit/routes.js";
import { authRoutes } from "./modules/auth/routes.js";
import { fileRoutes } from "./modules/files/routes.js";
import { metaRoutes } from "./modules/meta/routes.js";
import { notificationRoutes } from "./modules/notifications/routes.js";
import { roleRoutes } from "./modules/roles/routes.js";
import { teamRoutes } from "./modules/team/routes.js";
import { tenantRoutes } from "./modules/tenants/routes.js";
import { businessRoutes } from "./modules/business-routes.js";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Called by cron with a secret header and no cookies, so CSRF does not apply.
const CSRF_EXEMPT = new Set(["/api/v1/internal/cron"]);

export function createApp() {
  const e = env();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", e.TRUST_PROXY); // Hostinger runs Node behind a proxy; needed for real client IPs
  app.set("etag", false);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const id = requestId();
    (req as any).requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "img-src": ["'self'", "data:", "blob:"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          // Only force HTTPS for sub-resources in production (local dev runs on http://localhost).
          "upgrade-insecure-requests": e.NODE_ENV === "production" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: e.NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
    }),
  );

  // General per-IP limit (in memory). Login/OTP have stricter limits stored in MySQL.
  app.use("/api", (req, res, next) => {
    const retry = memoryLimit(`ip:${req.ip}`, 600, 60_000);
    if (retry) {
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: { code: "rate_limited", message: "Too many requests. Slow down." } });
    }
    next();
  });

  app.use("/api", express.json({ limit: "1mb" }));
  app.use(cookieParser());

  // CSRF: unsafe requests must come from our own origin AND echo the CSRF cookie in a header.
  app.use("/api", (req, res, next) => {
    if (!UNSAFE.has(req.method) || CSRF_EXEMPT.has(req.originalUrl.split("?")[0]!)) return next();
    const origin = req.get("origin");
    if (origin && origin !== e.APP_ORIGIN && origin !== `${req.protocol}://${req.get("host")}`) {
      return res.status(403).json({ error: { code: "bad_origin", message: "Request blocked (wrong origin)." } });
    }
    const cookie = req.cookies?.[COOKIE_CSRF];
    const header = req.get("x-csrf-token");
    if (!cookie || !header || !safeEqual(String(cookie), header)) {
      return res.status(403).json({ error: { code: "csrf_failed", message: "Security check failed. Reload the page and try again." } });
    }
    next();
  });

  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use("/api/v1/auth", authRoutes.router);
  app.use("/api/v1/me", accountRoutes.router);
  app.use("/api/v1/team", teamRoutes.router);
  app.use("/api/v1", metaRoutes.router, tenantRoutes.router, roleRoutes.router, auditRoutes.router, fileRoutes.router, notificationRoutes.router, businessRoutes.router);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API endpoint." } });
  });

  // The built PWA (apps/pwa/dist) is served from the same Node app.
  // Bundled build serves dist/public; in development Vite serves the app instead.
  const publicDir = e.PUBLIC_DIR ? path.resolve(e.PUBLIC_DIR) : fileURLToPath(new URL("./public", import.meta.url));
  if (existsSync(path.join(publicDir, "index.html"))) {
    app.use(
      express.static(publicDir, {
        index: false,
        setHeaders(res, file) {
          if (file.endsWith("sw.js") || file.endsWith(".webmanifest")) res.setHeader("Cache-Control", "no-cache");
          else if (/\/assets\//.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(publicDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
