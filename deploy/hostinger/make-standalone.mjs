// Assembles apps/web/.next/standalone after `next build` for Hostinger's
// Node.js web hosting, which publishes `.next/standalone` and runs its
// `server.js`. The layout is flat (no pnpm symlinks), so it works wherever
// Hostinger copies it:
//   .next/standalone/server.js        tiny entry that starts Next in this folder
//   .next/standalone/.next            the compiled app (without cache)
//   .next/standalone/public, next.config.mjs, package.json, node_modules
//   .next/standalone/packages/server/assets/fonts   (PDF fonts)
// Run from apps/web:  node ../../deploy/hostinger/make-standalone.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const web = process.cwd();
const root = path.resolve(web, "../..");
const out = path.join(web, ".next", "standalone");
if (!existsSync(path.join(web, ".next", "BUILD_ID"))) throw new Error("Run `next build` first");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const entry of readdirSync(path.join(web, ".next"))) {
  if (entry === "cache" || entry === "standalone") continue;
  cpSync(path.join(web, ".next", entry), path.join(out, ".next", entry), { recursive: true });
}
cpSync(path.join(web, "public"), path.join(out, "public"), { recursive: true });
cpSync(path.join(root, "packages/server/assets/fonts"), path.join(out, "packages/server/assets/fonts"), { recursive: true });

const webPkg = JSON.parse(readFileSync(path.join(web, "package.json"), "utf8"));
const serverPkg = JSON.parse(readFileSync(path.join(root, "packages/server/package.json"), "utf8"));
const runtime = ["next", "react", "react-dom", "pg", "pdfkit", "qrcode", "jszip", "nodemailer"];
const dependencies = Object.fromEntries(
  runtime.map((k) => {
    const v = webPkg.dependencies?.[k] ?? serverPkg.dependencies?.[k];
    if (!v) throw new Error(`No version for ${k}`);
    return [k, v];
  }),
);
writeFileSync(
  path.join(out, "package.json"),
  JSON.stringify({ name: "crazy-business-web", private: true, main: "server.js", scripts: { start: "node server.js" }, dependencies }, null, 2) + "\n",
);

// Runtime copy of next.config (headers etc.); build-only options dropped.
const src = readFileSync(path.join(web, "next.config.ts"), "utf8");
const headers = src.slice(src.indexOf("const securityHeaders"), src.indexOf("const config"));
writeFileSync(
  path.join(out, "next.config.mjs"),
  `${headers}const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pdfkit", "qrcode", "jszip", "nodemailer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
`,
);

writeFileSync(
  path.join(out, "server.js"),
  `// Production entry for hosts that run a standalone server.js (e.g. Hostinger).
process.chdir(__dirname);
process.env.NODE_ENV = "production";
const http = require("node:http");
const next = require("next");
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();
const port = Number(process.env.PORT) || 3000;
app.prepare().then(() => {
  http.createServer((req, res) => handle(req, res)).listen(port, () => {
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", message: "server: listening on port " + port }));
  });
});
`,
);

// Flat node_modules with only the runtime packages (no workspace symlinks).
execSync("npm install --omit=dev --omit=optional --no-audit --no-fund --no-package-lock", { cwd: out, stdio: "inherit" });
console.log(`standalone ready: ${out}`);
