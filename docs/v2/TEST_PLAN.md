# Step 1 test plan and sample data

## A. Automated tests (run on every push by GitHub Actions)

```bash
pnpm --filter @biz/api test    # 48 tests against a real MariaDB/MySQL database
pnpm --filter @biz/pwa test    # 6 tests: translations complete, ₹/date/phone formats
```
CI runs the API tests on **MariaDB 11.4 and MySQL 8.4**.
Locally they need a MySQL/MariaDB admin login: `TEST_DB_ADMIN_USER` / `TEST_DB_ADMIN_PASSWORD` (default `root`, no password).
They create a throwaway database `bizapp_test` and an app user with only SELECT/INSERT/UPDATE/DELETE.

| Area | What the tests prove |
| --- | --- |
| OTP login | sign-up creates user + httpOnly cookies; wrong OTP; 5-try lock; single use; 30 s cooldown; 5/hour per number; 20/hour per IP; global daily cap; bad numbers rejected |
| CSRF / origin | missing CSRF header → 403; other website's origin → 403 |
| Tokens & sessions | refresh rotation; re-used old refresh token revokes the session; logout; list & sign out other devices; invalid token → 401 |
| Password | set password; login by email or mobile; weak password refused; lock after 10 wrong; OTP still works when locked; same error for unknown account; reset via OTP signs out all devices; no account enumeration |
| Onboarding | business + 2 branches + 5 roles + owner + numbering + units + cash account; GSTIN checksum/state checks; one person owns 2 businesses and switches |
| Isolation | user A gets 403 for B's business, 404 for B's ids; `TenantDb` refuses unscoped SQL; MySQL refuses a cross-business foreign key |
| Roles | cashier blocked from team/audit/settings; custom roles; unknown & owner-only permissions refused; no escalation; built-in roles locked; role in use can't be deleted; changes apply on the next request; disabled member loses access |
| Team | invite returns `wa.me` link; invitation accepted on first OTP or password sign-in; owner can't change own access; admin can't touch owner; last owner protected; branch restriction |
| Numbering | 12 bills at the same moment get 0001…0012 with no gaps/duplicates; new FY restarts at 0001; rolled-back bill returns its number; series can't go backwards; >16 chars refused |
| Audit | create/update/delete recorded with field-level changes and user name; filters + paging; DB triggers block edit/delete; secrets masked |
| Jobs | run, retry with backoff, give up after max attempts; dedupe; recover a job whose worker died; audit CSV export via queue (formula injection neutralised, cashier can't download); encrypted backup contains only that business; trial → grace → expired (read-only) with notifications; cron endpoint needs the secret |
| Files | real PNG accepted & served only to members, stored under `t_<tenant>/logo/…`; fake PNG, SVG, too-large files refused |
| Routes | every route declares access; exact list of public routes |

## B. Manual test plan (please try these on your phone)

Setup: deploy (see [DEPLOY_HOSTINGER.md](DEPLOY_HOSTINGER.md)) or run locally (bottom of this page), then load the sample data.

| # | Do this | You should see |
| --- | --- | --- |
| 1 | Open the site on an Android phone in Chrome → menu → **Install app** | App icon "CB" on home screen; opens full-screen |
| 2 | Sign in with **90000 00001**, enter the OTP | "Choose a business" with 2 businesses |
| 3 | Tap **Sri Lakshmi Mobiles (Demo)** | Home: "Namaste, Ravi Kumar", trial end date in dd/mm/yyyy |
| 4 | Turn on airplane mode, close and reopen the app | App still opens and shows "You are offline" (data needs internet until Step 2's offline billing) |
| 5 | **Team** → Add a person → your second phone's number, role Cashier, only Kukatpally | Success message + "Send invite on WhatsApp" link that opens WhatsApp with a ready message |
| 6 | On the second phone, sign in with that number | Lands directly in Sri Lakshmi Mobiles; only Home and My account in the menu |
| 7 | On phone 1, change that person's role to Manager | Within ~15 s (next poll / next tap) phone 2 sees Team, Roles, Audit, Settings |
| 8 | On phone 1, **Disable access** for that person | Phone 2's next action shows no access to the business |
| 9 | **Roles** → New custom role "Delivery boy", start from Cashier, untick "Add customers", Save | Role listed as Custom with 0 people |
| 10 | Open the built-in **Manager** role | Read-only, with "Built-in roles cannot be changed" |
| 11 | **Settings** → change City, Save. Upload a PNG logo | "Saved"; logo appears |
| 12 | Settings → type an invalid GSTIN (e.g. change the last letter) | Error under GSTIN; not saved |
| 13 | Settings → Numbering: change Invoice prefix to `SL` | Preview shows `SL/26-27/0001` |
| 14 | **Audit log** → tap "Changes" on "Updated business details" | Old city crossed out → new city, your name, time in IST |
| 15 | Audit log → **Export to Excel (CSV)** | "Preparing file…", then within ~1 minute (cron) a Download button; file opens in Excel with Hindi/Telugu intact |
| 16 | **My account** → Language → हिन्दी, then తెలుగు, then Hinglish | Whole app switches language; choice is remembered on this phone and saved to your profile |
| 17 | My account → Set password → sign out → **Password** tab → sign in with mobile + password | Works |
| 18 | Enter a wrong password 10 times | "Too many wrong passwords…"; OTP sign-in still works |
| 19 | Ask for OTP twice quickly | Second request: "Please wait 30 seconds…" |
| 20 | My account → Signed-in devices → sign out the other phone | That phone is sent to the sign-in screen on its next action |
| 21 | Tap the business name at the top → choose **Annapurna Tiffins (Demo)** | Switches business; Team list is different |
| 22 | Sign in with a brand-new number | "Set up your business" form; create one; lands on Home |

## C. Sample data (all fictional)

Load with `pnpm --filter @biz/api seed` (needs the `DB_*` variables of a migrated database).

| Who | Mobile | Role | Notes |
| --- | --- | --- | --- |
| Ravi Kumar (Demo) | 90000 00001 | Owner of both businesses | Also password `Demo2026pass` (change with `DEMO_PASSWORD`) |
| Suresh (Manager, Demo) | 90000 00002 | Manager | all branches |
| Priya (Cashier, Demo) | 90000 00003 | Cashier / Staff | Kukatpally branch only |
| Anil (Accountant, Demo) | 90000 00004 | Accountant | all branches |

Businesses:
- **Sri Lakshmi Mobiles (Demo)** — retail, Telangana (36), fictional GSTIN `36AAAFZ1234A1ZQ`, branches *Ameerpet* (invoice prefix `SLM`) and *Kukatpally* (`SLK`), plus a custom role **Store keeper**.
- **Annapurna Tiffins (Demo)** — restaurant, Secunderabad, no GSTIN.

Team members show as **Invited** until they first sign in with OTP.

In development the OTP is printed in the server log (`[sms:console] OTP for +91******0001 is 123456`). In production it goes by SMS.

## D. Run it on your computer

Needs Node 20+, pnpm 10, and MySQL 8 or MariaDB 10.6+.

```bash
pnpm install
```
```bash
cp apps/api/.env.example apps/api/.env   # fill DB_*, secrets; NODE_ENV=development; SMS_PROVIDER=console; APP_ORIGIN=http://localhost:5173
```
```bash
cd apps/api && set -a && . ./.env && set +a && pnpm migrate && pnpm seed && pnpm dev
```
```bash
pnpm --filter @biz/pwa dev    # open http://localhost:5173
```
