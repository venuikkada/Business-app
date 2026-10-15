#!/usr/bin/env bash
# Builds the web app into a self-contained bundle for Hostinger's Node.js web
# hosting (Business / Cloud plans). The monorepo is compiled here; the bundle
# only needs `npm install` (six runtime packages) and `next start`, so the
# Hostinger builder never has to understand the pnpm workspace.
#   ./deploy/hostinger/build-node-bundle.sh [output.zip]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_ZIP="${1:-$ROOT/dist/hostinger-web_$(date +%Y%m%d_%H%M%S).zip}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cd "$ROOT"
pnpm --filter @cba/web build

cp -r apps/web/.next "$STAGE/.next"
rm -rf "$STAGE/.next/cache"
cp -r apps/web/public "$STAGE/public"
mkdir -p "$STAGE/packages/server/assets"
cp -r packages/server/assets/fonts "$STAGE/packages/server/assets/fonts"

# Runtime dependencies, pinned to the versions the build was made with.
node - "$STAGE" <<'EOF'
const fs = require("fs");
const path = require("path");
const stage = process.argv[2];
const web = require(path.resolve("apps/web/package.json"));
const keep = ["next", "react", "react-dom", "pg", "pdfkit", "qrcode", "jszip", "nodemailer"];
const deps = {};
for (const k of keep) {
  const v = web.dependencies[k] ?? require(path.resolve("packages/server/package.json")).dependencies[k];
  if (!v) throw new Error(`missing version for ${k}`);
  deps[k] = v;
}
fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({
  name: "crazy-business-web",
  private: true,
  version: web.version ?? "0.1.0",
  engines: { node: ">=20" },
  scripts: {
    // Already compiled in the monorepo; nothing to build on the server.
    build: "node -e \"console.log('Using the prebuilt .next directory')\"",
    start: "next start -p ${PORT:-3000}",
  },
  dependencies: deps,
}, null, 2) + "\n");

// Runtime copy of next.config (headers etc.); build-only options are dropped.
const src = fs.readFileSync(path.resolve("apps/web/next.config.ts"), "utf8");
const headers = src.slice(src.indexOf("const securityHeaders"), src.indexOf("const config"));
fs.writeFileSync(path.join(stage, "next.config.mjs"),
  headers.replace("import type { NextConfig } from \"next\";", "") +
  `const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["pg", "pdfkit", "qrcode", "jszip", "nodemailer"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
`);
EOF

mkdir -p "$(dirname "$OUT_ZIP")"
rm -f "$OUT_ZIP"
(cd "$STAGE" && zip -qr "$OUT_ZIP" .)
echo "$OUT_ZIP ($(du -h "$OUT_ZIP" | cut -f1))"
