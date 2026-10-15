# REST API (v1)

Base URL: `https://<your-domain>/api/v1`. JSON in, JSON out. Used by the web pages
(via `fetch`) and the Android app. Source of truth: `apps/web/src/lib/routes.ts`.

## Authentication

| Client | How |
| --- | --- |
| Browser | `POST /auth/login` sets an httpOnly `cba_session` cookie. Every write must send `x-cba-csrf: 1` (and comes from the same Origin). |
| Mobile / scripts | Send `X-Client: android` on `POST /auth/login` → response contains `token`. Then `Authorization: Bearer <token>`. |

Auth column below: **public** = no login, **user** = signed in, **tenant** = signed
in *and* a member of the selected business (with the permission the endpoint needs).

## Selecting the business

Send `X-Business-Id: <uuid>` (mobile) or call `POST /businesses/:id/select` (web
cookie). If the user belongs to exactly one business it is used automatically.

## Safe retries

`POST` create endpoints accept `Idempotency-Key: <random string>`. Repeating a
request with the same key (same user + business) returns the original response
instead of creating a duplicate — use one key per user action.

## Errors

```json
{ "error": { "code": "PLAN_LIMIT", "message": "Your free plan allows 30 invoices per month…", "details": { "limit": "invoices_per_month", "max": 30 } } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| VALIDATION | 422 | Bad input; `details.issues[]` has `path` + `message` |
| UNAUTHENTICATED | 401 | Not signed in / session expired |
| MFA_REQUIRED | 401 | Send the 6-digit `totp` with the login |
| FORBIDDEN | 403 | Missing permission (or read-only support/suspended mode) |
| NOT_FOUND | 404 | Doesn't exist **or belongs to another business** |
| CONFLICT / BUSINESS_RULE | 409 / 422 | e.g. editing an issued invoice |
| NEGATIVE_STOCK | 409 | Retry with `allowNegativeStock: true` (owner/manager, audited) |
| APPROVAL_REQUIRED | 409 | An approval request was created; retry with `approvalId` once approved |
| POSSIBLE_DUPLICATE | 409 | Retry with `confirmDuplicate: true` |
| PLAN_LIMIT / FEATURE_NOT_IN_PLAN | 402 | Upgrade needed |
| RATE_LIMITED | 429 | Slow down |
| NOT_CONFIGURED | 503 | e.g. Razorpay keys not set |

## Conventions

- Money and quantities are **strings** (`"1234.50"`) — never floats.
- Dates are `YYYY-MM-DD` in India time (Asia/Kolkata); timestamps are ISO 8601.
- Lists: `?page=1&pageSize=25&q=…&sort=…` → `{ items, total, page, pageSize }`.
- Reports: `GET /reports/:name?preset=month|today|week|last_month|quarter|fy|last_fy` or
  `?from=…&to=…`, add `&format=csv` or `&format=pdf` to download.
- Files (PDF/CSV) are returned with `Content-Disposition`; add `?download=1` for PDFs.

## Endpoints

### System

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/health` | public |
| POST | `/api/v1/cron/daily` | public |

### Auth

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | public |
| POST | `/api/v1/auth/login` | public |
| POST | `/api/v1/auth/logout` | user |
| POST | `/api/v1/auth/forgot` | public |
| POST | `/api/v1/auth/reset` | public |
| POST | `/api/v1/auth/verify-email` | public |
| POST | `/api/v1/auth/resend-verification` | user |

### Account

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/me` | user |
| PATCH | `/api/v1/me` | user |
| POST | `/api/v1/me/password` | user |
| GET | `/api/v1/me/sessions` | user |
| POST | `/api/v1/me/totp/begin` | user |
| POST | `/api/v1/me/totp/confirm` | user |
| POST | `/api/v1/me/totp/disable` | user |
| POST | `/api/v1/me/delete` | user |
| POST | `/api/v1/invitations/accept` | user |

### Businesses

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/businesses` | user |
| POST | `/api/v1/businesses` | user |
| POST | `/api/v1/businesses/:id/select` | user |
| GET | `/api/v1/businesses/deleted` | user |
| POST | `/api/v1/businesses/:id/restore` | user |
| GET | `/api/v1/context` | tenant |
| GET | `/api/v1/business` | tenant |
| PUT | `/api/v1/business` | tenant |
| PUT | `/api/v1/business/settings` | tenant |
| POST | `/api/v1/business/delete` | tenant |

### Files

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/v1/files` | tenant |
| GET | `/api/v1/files/:id` | tenant |

### Customers & suppliers

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/parties` | tenant |
| POST | `/api/v1/parties` | tenant |
| POST | `/api/v1/parties/duplicates` | tenant |
| GET | `/api/v1/parties/export` | tenant |
| POST | `/api/v1/parties/import/preview` | tenant |
| POST | `/api/v1/parties/import/commit` | tenant |
| GET | `/api/v1/parties/:id` | tenant |
| PUT | `/api/v1/parties/:id` | tenant |
| POST | `/api/v1/parties/:id/archive` | tenant |
| POST | `/api/v1/parties/:id/unarchive` | tenant |
| GET | `/api/v1/parties/:id/ledger` | tenant |
| GET | `/api/v1/parties/:id/interactions` | tenant |
| POST | `/api/v1/parties/:id/interactions` | tenant |
| POST | `/api/v1/interactions/:id/complete` | tenant |
| GET | `/api/v1/followups` | tenant |
| GET | `/api/v1/parties/:id/unpaid` | tenant |
| GET | `/api/v1/parties/:id/reminder` | tenant |

### Products & stock

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/products` | tenant |
| POST | `/api/v1/products` | tenant |
| GET | `/api/v1/products/export` | tenant |
| POST | `/api/v1/products/import/preview` | tenant |
| POST | `/api/v1/products/import/commit` | tenant |
| GET | `/api/v1/products/barcode/:code` | tenant |
| GET | `/api/v1/products/:id` | tenant |
| PUT | `/api/v1/products/:id` | tenant |
| POST | `/api/v1/products/:id/archive` | tenant |
| POST | `/api/v1/products/:id/unarchive` | tenant |
| GET | `/api/v1/products/:id/movements` | tenant |
| GET | `/api/v1/categories` | tenant |
| POST | `/api/v1/categories` | tenant |
| PUT | `/api/v1/categories/:id` | tenant |
| POST | `/api/v1/stock/adjust` | tenant |
| POST | `/api/v1/stock/transfer` | tenant |
| GET | `/api/v1/stock/low` | tenant |
| GET | `/api/v1/stock/valuation` | tenant |

### Documents (quotations, orders, invoices, purchases, notes)

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/documents` | tenant |
| POST | `/api/v1/documents` | tenant |
| POST | `/api/v1/documents/preview` | tenant |
| GET | `/api/v1/documents/:id` | tenant |
| PUT | `/api/v1/documents/:id` | tenant |
| POST | `/api/v1/documents/:id/finalize` | tenant |
| POST | `/api/v1/documents/:id/cancel` | tenant |
| POST | `/api/v1/documents/:id/convert` | tenant |
| POST | `/api/v1/documents/:id/duplicate` | tenant |
| POST | `/api/v1/documents/:id/status` | tenant |
| GET | `/api/v1/documents/:id/pdf` | tenant |
| GET | `/api/v1/documents/:id/share` | tenant |
| POST | `/api/v1/documents/:id/shared` | tenant |

### Payments & dues

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/payments` | tenant |
| POST | `/api/v1/payments` | tenant |
| GET | `/api/v1/payments/:id` | tenant |
| POST | `/api/v1/payments/:id/void` | tenant |
| POST | `/api/v1/payments/:id/allocate` | tenant |
| GET | `/api/v1/payments/:id/pdf` | tenant |
| GET | `/api/v1/outstanding` | tenant |

### Expenses, accounts, cashbook

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/expenses` | tenant |
| POST | `/api/v1/expenses` | tenant |
| GET | `/api/v1/expenses/:id` | tenant |
| POST | `/api/v1/expenses/:id/void` | tenant |
| GET | `/api/v1/expense-categories` | tenant |
| POST | `/api/v1/expense-categories` | tenant |
| GET | `/api/v1/accounts` | tenant |
| POST | `/api/v1/accounts` | tenant |
| PATCH | `/api/v1/accounts/:id` | tenant |
| POST | `/api/v1/accounts/transfer` | tenant |
| POST | `/api/v1/accounts/entry` | tenant |
| GET | `/api/v1/cashbook` | tenant |

### Service & AMC

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/service/tickets` | tenant |
| POST | `/api/v1/service/tickets` | tenant |
| GET | `/api/v1/service/tickets/:id` | tenant |
| PATCH | `/api/v1/service/tickets/:id` | tenant |
| POST | `/api/v1/service/tickets/:id/parts` | tenant |
| POST | `/api/v1/service/tickets/:id/invoice` | tenant |
| GET | `/api/v1/amc` | tenant |
| POST | `/api/v1/amc` | tenant |
| GET | `/api/v1/amc/:id` | tenant |
| POST | `/api/v1/amc/:id/renew` | tenant |
| POST | `/api/v1/amc/:id/cancel` | tenant |
| POST | `/api/v1/amc/:id/invoice` | tenant |

### Team, roles, branches

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/team` | tenant |
| POST | `/api/v1/team/invitations` | tenant |
| PATCH | `/api/v1/team/members/:id` | tenant |
| GET | `/api/v1/roles` | tenant |
| GET | `/api/v1/roles/templates` | tenant |
| POST | `/api/v1/roles` | tenant |
| PUT | `/api/v1/roles/:id` | tenant |
| GET | `/api/v1/branches` | tenant |
| POST | `/api/v1/branches` | tenant |
| PUT | `/api/v1/branches/:id` | tenant |
| POST | `/api/v1/branches/:id/archive` | tenant |

### Support

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/support-grants` | tenant |
| POST | `/api/v1/support-grants/:id` | tenant |
| GET | `/api/v1/support` | tenant |
| POST | `/api/v1/support` | tenant |
| GET | `/api/v1/support/:id` | tenant |
| POST | `/api/v1/support/:id/reply` | tenant |

### Audit & approvals

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/audit` | tenant |
| GET | `/api/v1/audit/:id` | tenant |
| GET | `/api/v1/approvals` | tenant |
| POST | `/api/v1/approvals/:id` | tenant |

### Notifications

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/notifications` | tenant |
| POST | `/api/v1/notifications/read` | tenant |

### Reports

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/dashboard` | tenant |
| GET | `/api/v1/reports/:name` | tenant |

### Billing

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/billing` | tenant |
| POST | `/api/v1/billing/checkout` | tenant |
| POST | `/api/v1/billing/verify` | tenant |
| POST | `/api/v1/billing/cancel` | tenant |
| POST | `/api/v1/billing/resume` | tenant |
| POST | `/api/v1/webhooks/razorpay` | public |

### Data

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/export` | tenant |

### Public share links

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/api/v1/public/documents/:token` | public |
| GET | `/api/v1/public/documents/:token/pdf` | public |
