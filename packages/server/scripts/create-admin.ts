/**
 * Grants platform super-admin rights to an EXISTING user account. Deliberately
 * a command-line step (not a button) so admin rights can only be granted by
 * someone with database owner credentials. The admin must enrol TOTP on first
 * sign-in to the admin panel.
 *   MIGRATION_DATABASE_URL=... pnpm tsx scripts/create-admin.ts person@example.com
 */
import pg from "pg";

const url = process.env.MIGRATION_DATABASE_URL;
const email = process.argv[2];
if (!url || !email) {
  console.error("Usage: MIGRATION_DATABASE_URL=... tsx scripts/create-admin.ts <email>");
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const r = await c.query("update users set is_platform_admin = true where email = $1 and status = 'active' returning id", [email]);
if (!r.rowCount) console.error(`No active user with email ${email}. Register in the web app first.`);
else {
  await c.query("insert into platform_audit_logs(action, target_type, target_id, details) values ('admin.grant', 'user', $1, $2)", [r.rows[0].id, JSON.stringify({ email, via: "cli" })]);
  console.log(`${email} is now a platform admin. Sign in at the admin app and enrol two-factor authentication.`);
}
await c.end();
