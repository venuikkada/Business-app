# Testing

## Automated tests — latest results (development environment, 15 Oct 2026)

| Suite | Command | Result |
| --- | --- | --- |
| Type check (all TS packages + apps) | `pnpm typecheck` | ✅ clean |
| Core unit tests (GST engine + shared vectors, money, Indian formats, GSTIN, words, CSV, schemas, permissions) | `pnpm --filter @cba/core test` | ✅ 337 passed |
| Server integration tests against real PostgreSQL 16 (RLS on) | `pnpm --filter @cba/server test` | ✅ 47 passed |
| Web + admin production build | `pnpm build` | ✅ |
| Playwright E2E (Chromium desktop + Pixel 7 mobile) | `pnpm test:e2e` (+ `E2E_DEMO_EMAIL` for mobile) | ✅ 3 passed |
| Kotlin `:core` (GST vectors shared with server, API client with mock server, offline draft sync) | `cd apps/android && gradle :core:test` | ✅ 11 passed (incl. live API contract test when `CBA_API_URL` is set) |
| Kotlin `:app` (Compose UI) | `./gradlew :app:assembleDebug` | ⚠️ **not compiled here** (no Android SDK). CI compiles it on GitHub runners. |
| Backup → restore → verify | `scripts/backup.sh`, `restore.sh`, `verify-restore.sh` | ✅ identical counts and totals |

Server tests create a throwaway database, run all migrations, connect as the real
`cba_app` / `cba_platform` roles (so RLS is exercised), and drop the database after.

## Spec acceptance tests → automated coverage

| # | Acceptance test (spec §11) | Covered by |
| --- | --- | --- |
| 1 | Register, sign in, create a business | `acceptance.test.ts` "1. registration…", E2E journey |
| 2 | Business B cannot see business A's data | `acceptance.test.ts` "2. tenant isolation" (API, raw SQL as app role, platform role), E2E cross-tenant |
| 3 | Add customers and products | `acceptance.test.ts` "3–6", E2E journey |
| 4 | Create quotation → convert to invoice | `acceptance.test.ts` "3–6", E2E journey |
| 5 | GST totals correct (CGST/SGST/IGST, inclusive, discounts, round-off) | 337 core tests + `test-vectors/gst.json` (shared with Kotlin), `workflows.test.ts` IGST & bill-of-supply |
| 6 | Stock reduces exactly once | `acceptance.test.ts` "exactly once" + DB unique constraint test |
| 7 | Partial payments & outstanding | `acceptance.test.ts` "7. partial, full, over- and voided payments" |
| 8 | Purchases & expenses in reports | `acceptance.test.ts` "8", `workflows.test.ts` "every report type and date preset" |
| 9 | Unauthorised users blocked from financial records | `acceptance.test.ts` "9. salesperson and technician…" |
| 10 | Plan limits enforced server-side | `acceptance.test.ts` "10", `security.test.ts` user limit |
| 11 | Invoice PDF | `acceptance.test.ts` "11" (text extraction + one-page regression), E2E PDF download |
| 12 | Audit trail | `acceptance.test.ts` "12" (append-only, incl. purge-bypass attempt) |

Plus `security.test.ts`: lockout, password reset, session revocation, tampered tokens,
TOTP, account deletion, invitation privilege escalation, admin TOTP enforcement, support
access grants, suspension, Razorpay signature/verification/webhook idempotency, business
deletion/restore/purge. `workflows.test.ts`: returns, cancellation, serials & warranty,
approvals, parallel numbering, bill of supply, IGST, purchase orders, branch transfers,
service tickets, AMC, notifications, CSV import, duplicate warnings, idempotency, data export.
`mailer.test.ts`: SMTP delivery and failure handling.

## Not covered by automated tests

- Android UI (no instrumented tests yet), real devices, low-end phones.
- Live Razorpay (only signature vectors + mocked gateway).
- S3 storage driver against a real bucket.
- Load / performance testing; accessibility audit (some ARIA labels exist, no audit run).
- Cross-browser beyond Chromium (Safari/iOS, Firefox).

## Manual QA checklist (run before each release)

### Web (desktop and phone browser)
- [ ] Register → verify email → create business with GSTIN (wrong checksum is rejected).
- [ ] Settings: logo, bank/UPI details, invoice terms, number prefixes, GST scheme.
- [ ] Add customer in another state → invoice uses IGST; same state → CGST+SGST.
- [ ] Quotation → convert to invoice → issue → PDF looks right (₹ symbol, amount in
      words, HSN, tax breakup, UPI QR) → share link opens logged-out.
- [ ] Record partial payment, then the rest; outstanding & aging update.
- [ ] Sell more than stock → blocked; owner override works and is in the audit log.
- [ ] Serial-tracked product: purchase with serials → sell → warranty lookup by serial.
- [ ] Salesperson login: can't see cost/profit; discount above threshold needs approval.
- [ ] Free plan: 31st invoice in a month is blocked with an upgrade message.
- [ ] Reports: each report for "This month" and a custom range; CSV and PDF download.
- [ ] Export all data (ZIP); delete business → restore within 30 days.
- [ ] Phone width (360 px): no sideways scrolling; bottom navigation works.

### Admin
- [ ] Sign-in requires TOTP enrolment; wrong code rejected.
- [ ] Business list shows counts only — no customer/invoice details.
- [ ] Support access: request → owner approves in Settings → Support → read-only view → expires.
- [ ] Edit a plan price/limit → reflected on /pricing and enforcement.

### Android
- [ ] Fresh install → onboarding → register → create business.
- [ ] Create invoice: totals match the web for the same items; issue; share PDF to WhatsApp.
- [ ] Airplane mode while saving → appears in Offline drafts → reconnect → synced once (no duplicate).
- [ ] Scan a product barcode and a serial number; deny camera permission → manual entry works.
- [ ] Record payment; WhatsApp reminder opens with the message.
- [ ] Session survives app restart; sign out clears it; revoked session returns to login.
- [ ] Release build refuses `http://` API URLs.
