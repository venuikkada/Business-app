# API endpoint list — Step 1

Base URL: `https://<your-domain>/api/v1`. JSON in, JSON out.

- **Success:** `{ "data": … }` (or HTTP 204 with no body).
- **Error:** `{ "error": { "code": "otp_invalid", "message": "…", "details": …, "requestId": "…" } }`.
  The app translates `code`; `message` is English for logs and fallbacks.
- **Auth:** httpOnly cookies set by the server (`ba_at` access token 15 min, `ba_rt` refresh token 30 days).
  The app never sees the tokens.
- **CSRF:** every POST/PATCH/PUT/DELETE must send header `X-CSRF-Token` equal to the `ba_csrf` cookie
  (get it from `GET /auth/csrf`). Requests from another website's origin are refused.
- **Which business:** header `X-Tenant-Id: <id>` (one per browser tab); falls back to the business last opened on this device.
  Membership, role and branch access are re-checked on **every** request.
- **Expired plan:** writes return `402 subscription_expired`; reading and exporting keep working.

## Who can call what

Every route declares its rule in code; an automated test fails if any route has none
(`apps/api/test/audit-jobs-files.test.ts`). This table is generated from the code with
`npx tsx apps/api/scripts/print-routes.ts`.

"signed in" = any signed-in person (no business needed). "any_member" = any active member of the open business.

| Method | Path | Who can call | What it does |
| --- | --- | --- | --- |
| GET | `/auth/csrf` | public | Get CSRF token (sets `ba_csrf` cookie) |
| POST | `/auth/otp/request` | public | Send OTP. Body `{ mobile, purpose: "login" \| "reset_password" }` |
| POST | `/auth/otp/verify` | public | Sign in / sign up with OTP. Body `{ mobile, otp, name? }`. Accepts pending invitations |
| POST | `/auth/login` | public | Email-or-mobile + password. Body `{ identifier, password }` |
| POST | `/auth/password/reset` | public | Forgot password. Body `{ mobile, otp, newPassword }`. Signs out all devices |
| POST | `/auth/refresh` | public (needs refresh cookie) | Rotate tokens. Re-use of an old token revokes the session |
| POST | `/auth/logout` | public | Revoke this device's session, clear cookies |
| GET | `/me` | signed in | My profile + list of my businesses |
| PATCH | `/me` | signed in | Change name, email, language |
| POST | `/me/password` | signed in | Set / change password (signs out other devices) |
| GET | `/me/sessions` | signed in | My signed-in devices |
| DELETE | `/me/sessions/:id` | signed in | Sign out one device |
| POST | `/me/sessions/revoke-others` | signed in | Sign out all other devices |
| GET | `/tenants` | signed in | Businesses I belong to |
| POST | `/tenants` | signed in | **Onboarding**: create business, branches, roles, numbering, defaults |
| POST | `/tenants/:id/switch` | signed in | Open another business on this device |
| GET | `/tenant` | any_member | Open business: details, modules, branches, my role & permissions |
| PATCH | `/tenant` | settings.edit | Edit business details (GSTIN validated, state must match) |
| POST | `/tenant/logo` | settings.edit | Upload logo (multipart `file`; PNG/JPG/WebP, max 1 MB) |
| GET | `/branches` | any_member | Branches (only the ones I may use) |
| POST | `/branches` | settings.edit | Add branch (also creates its number series) |
| PATCH | `/branches/:id` | settings.edit | Edit / close / reopen / make main |
| GET | `/document-series` | settings.view | Numbering per branch & document type for a financial year |
| PATCH | `/document-series/:id` | settings.edit | Change prefix / next number (cannot go backwards; ≤ 16 chars) |
| GET | `/team` | team.view | Team members with role, branches, status |
| POST | `/team` | team.invite | Add person by mobile → returns a `wa.me` invite link |
| PATCH | `/team/:id` | team.edit | Change role, branches, status, display name |
| DELETE | `/team/:id` | team.remove | Remove person from the business |
| GET | `/permissions` | roles.view or roles.manage | Permission checkboxes for the role editor |
| GET | `/roles` | roles.view or team.view | Roles with member counts |
| POST | `/roles` | roles.manage | Create custom role |
| PATCH | `/roles/:id` | roles.manage | Edit custom role (built-in roles are locked) |
| DELETE | `/roles/:id` | roles.manage | Delete custom role (only if nobody has it) |
| GET | `/audit-logs` | audit.view | Filters: `entityType, entityId, userId, action, from, to` (IST dates), `before` cursor, `limit` |
| POST | `/audit-logs/export` | audit.export | Queue a CSV export job → `{ jobId }` (HTTP 202) |
| GET | `/jobs/:id` | any_member | Job status; when done, `result.fileId` |
| POST | `/files` | items.edit / expenses.create / employees.edit / purchases.create / settings.edit | Upload attachment (`kind` = item_image, document, employee_doc, attachment; max 5 MB) |
| GET | `/files/:id` | any_member (+ payroll.view for payslips, data.export / audit.export for exports, employees.view for staff documents) | Download a file of this business only |
| GET | `/poll` | any_member | Live updates: unread count + change cursor. The app calls this every 15 s |
| GET | `/notifications` | any_member | My notifications |
| POST | `/notifications/read-all` | any_member | Mark all read |
| POST | `/notifications/:id/read` | any_member | Mark one read |
| GET | `/health` | public | Database ping (for uptime monitors) |
| GET | `/meta` | public | Sectors, states (GST codes), GST rates, languages |
| POST | `/internal/cron` | secret header `X-Cron-Key` | Cron fallback: run due jobs for ≤ 50 s |

## Planned for Step 2 (retail) — not built yet

Items & variants, barcode lookup, stock in/out/transfer/adjust, parties & ledger, quotations →
orders → invoices → payments → credit notes, purchases, cash/bank/UPI & day book, expenses with
approvals, employees, attendance, leave, payroll & payslip PDF, reports with Excel/PDF export,
offline billing sync (`Idempotency-Key` header + `client_uuid`). The database tables for these already exist.
