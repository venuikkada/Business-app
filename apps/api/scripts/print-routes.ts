// Prints every API route with who may call it (used to write docs/v2/API.md).
//   npx tsx scripts/print-routes.ts
process.env.DB_USER ??= "x";
process.env.DB_NAME ??= "x";
process.env.JWT_SECRET ??= "x".repeat(32);
process.env.OTP_SECRET ??= "x".repeat(32);
process.env.DATA_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.CRON_SECRET ??= "x".repeat(32);
const { createApp } = await import("../src/app.js");
const { ROUTE_REGISTRY } = await import("../src/http/router.js");
createApp();
const who = (r: (typeof ROUTE_REGISTRY)[number]) =>
  r.access === "public" ? "public" : r.access === "user" ? "signed in" : r.perm!.join(" or ");
console.log("| Method | Path | Who can call |\n| --- | --- | --- |");
for (const r of ROUTE_REGISTRY) console.log(`| ${r.method} | \`/api/v1${r.path}\` | ${who(r)} |`);
export {};
