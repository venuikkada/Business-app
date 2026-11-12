// Builds a self-contained folder (apps/api/dist) for Hostinger Node.js hosting:
//   server.js  cron.js  migrate.js  migrations/*.sql  public/ (the PWA)  package.json
// All npm packages are bundled in, so the server needs no `npm install`.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const out = path.join(root, "dist");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: {
    server: path.join(root, "src/server.ts"),
    cron: path.join(root, "src/cron.ts"),
    migrate: path.join(root, "src/db/migrate-cli.ts"),
  },
  outdir: out,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  // CommonJS packages (express, mysql2) need `require` inside an ES module bundle.
  // pdfkit also needs __dirname to find its font metric files (copied to dist/data below).
  banner: { js: "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);" },
  logLevel: "warning",
});

await cp(path.resolve(root, "../../db/mysql"), path.join(out, "migrations"), { recursive: true });
await cp(path.join(root, "assets/fonts"), path.join(out, "fonts"), { recursive: true });
await cp(path.join(root, "node_modules/pdfkit/js/data"), path.join(out, "data"), { recursive: true });
const pwa = path.resolve(root, "../pwa/dist");
if (existsSync(pwa)) await cp(pwa, path.join(out, "public"), { recursive: true });
else console.warn("warning: apps/pwa/dist not found — build the PWA first (pnpm --filter @biz/pwa build)");

await writeFile(
  path.join(out, "package.json"),
  JSON.stringify(
    {
      name: "crazy-business-server",
      private: true,
      type: "module",
      engines: { node: ">=20" },
      scripts: { start: "node server.js", migrate: "node migrate.js", cron: "node cron.js" },
    },
    null,
    2,
  ) + "\n",
);
await cp(path.join(root, ".env.example"), path.join(out, ".env.example"));
console.log("built:", (await readdir(out)).join(", "));
