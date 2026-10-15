# CRAZY BUSINESS APP — Android

Kotlin + Jetpack Compose (Material 3). Talks only to the CRAZY BUSINESS REST API
(`/api/v1`) with a per-device session token. No database credentials, service
keys or payment secrets are ever compiled into the app — the server enforces
every permission, plan limit and tenant boundary.

## Modules

| Module | What | Builds without Android SDK? |
| --- | --- | --- |
| `:core` | Pure Kotlin/JVM: GST calculator (same test vectors as the server), Indian formats, typed API client (OkHttp), offline-draft sync logic | **Yes** — `gradle :core:test` |
| `:app`  | Compose UI, Keystore-encrypted session, Room offline drafts, WorkManager sync, CameraX + ML Kit barcode scanner, PDF/WhatsApp sharing | No — needs Android SDK 35 |

`settings.gradle.kts` only includes `:app` when an Android SDK is found
(`ANDROID_HOME`, `ANDROID_SDK_ROOT` or `local.properties` `sdk.dir`).

> **Honest status:** `:core` is compiled and tested (11 tests, including an
> optional live test against a running server). `:app` compiles: GitHub Actions
> builds a **debug** APK on every push (artifact `crazy-business-debug-apk`).
> It has **not yet been run on a phone or emulator**, so expect UI bugs on first
> use. No signed release has been built or published to Google Play.

## Screens

Onboarding → sign in / register / forgot password → choose or create business →
tabs: **Home** (today's sales, period sales vs cash collected vs profit estimates,
dues, low stock, recent documents), **Sales** (invoices, quotations, credit notes;
new invoice/quotation with live CGST/SGST/IGST totals; issue, convert quotation →
invoice, record payment, share on WhatsApp, share PDF), **Items** (search, low
stock, detail with branch stock; barcode/serial scanner), **Parties** (customers &
suppliers, add with GSTIN/phone validation and duplicate warning, balance, call,
WhatsApp payment reminder), **More** (outstanding receivable/payable, add expense,
notifications, offline drafts, open web app, switch business, sign out).

Advanced work (reports, purchases, stock adjustments, service tickets/AMC, team &
roles, settings, billing, import/export) is done in the web app.

## Offline behaviour

If the network drops while saving an invoice/quotation, it is stored in Room
with its Idempotency-Key and uploaded by WorkManager when the phone is online.
The server recomputes totals and numbers; drafts that fail validation are marked
“needs attention” with the server's message. Looking up customers/products still
needs connectivity (there is no full offline catalogue cache yet).

## Build (debug)

1. Install Android Studio (Ladybug or newer) with SDK 35, JDK 17.
2. Open `apps/android`. Let Gradle sync.
3. Start the web app (`pnpm dev` in repo root). The debug build calls
   `http://10.0.2.2:3000` (the host machine from the emulator). For a real
   phone on the same Wi-Fi: `./gradlew installDebug -PapiBaseUrl=http://192.168.x.y:3000`
   and add that IP to `app/src/debug/res/xml/network_security_config.xml`.
4. Sign in with the demo account from `pnpm db:seed` (see root README).

## Release

```bash
# keystore.properties (NEVER commit): storeFile, storePassword, keyAlias, keyPassword
./gradlew bundleRelease -PapiBaseUrl=https://your-domain.in -PversionCode=2 -PversionName=1.0.0
```

Release builds are HTTPS-only (cleartext blocked by network security config),
minified with R8, `allowBackup=false`. See `docs/GOOGLE_PLAY_CHECKLIST.md`.

## Tests

```bash
gradle :core:test                                   # unit tests (no SDK needed)
CBA_API_URL=http://localhost:3000 CBA_API_EMAIL=demo@crazybusiness.example \
  CBA_API_PASSWORD=DemoPassw0rd2026 gradle :core:test   # + live contract test
```
