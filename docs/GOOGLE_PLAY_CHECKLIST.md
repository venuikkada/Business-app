# Google Play release checklist

> Status: **no APK/AAB has been built or uploaded.** The `:app` module has not yet
> been compiled (no Android SDK was available where it was written). Start at step 1.

## 1. Build and fix

- [ ] Open `apps/android` in Android Studio (latest stable), JDK 17, SDK 35 installed.
- [ ] Gradle sync; fix any compile errors in `:app` (first-ever compile).
- [ ] Bump `compileSdk`/`targetSdk` (and AGP) if Play requires a newer API level at
      release time — Play requires targeting a recent Android version for new apps.
- [ ] `gradle :core:test` green; run the app on an emulator (API 24 and latest) and a
      real low-end phone (2–3 GB RAM) against a staging server.
- [ ] Walk the manual checklist in [TESTING.md](TESTING.md) (Android section).

## 2. Signing

- [ ] Create an upload keystore (keep two offline copies; losing it blocks updates):
      `keytool -genkeypair -v -keystore upload.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload`
- [ ] `apps/android/keystore.properties` (gitignored): `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
- [ ] Enrol in **Play App Signing** (Google holds the app signing key).
- [ ] `./gradlew bundleRelease -PapiBaseUrl=https://app.your-domain.in -PversionCode=1 -PversionName=1.0.0`
- [ ] Every later upload: increase `versionCode`.

## 3. Play Console account

- [ ] Developer account (organisation account recommended for a business app; needs
      D-U-N-S number). New personal accounts must run a closed test with testers for
      a period before production access — plan for it.
- [ ] App name "Crazy Business — GST Billing & Inventory" (check trademark availability),
      default language English (India); add Hindi listing later.

## 4. Store listing

- [ ] Short description (80 chars): "GST invoices, stock, dues & WhatsApp reminders for Indian shops."
- [ ] Full description: features that are actually implemented — no claims of GST portal
      filing, e-invoicing or e-way bills.
- [ ] Screenshots from the real app with **fictional demo data** (phone 16:9 + 7" tablet),
      feature graphic 1024×500, 512×512 icon.
- [ ] Category: Business. Contact email, website, privacy policy URL (`/privacy`).

## 5. Policy declarations

- [ ] **Data safety form** — data collected: name, email, phone (account); business and
      customer records the user enters; camera used only on-device for barcode scanning
      (images not uploaded). Data encrypted in transit (HTTPS only). Users can delete
      their account from the app (More → Delete my account, which opens web Settings →
      Security) or directly on the web — provide that URL in the form.
- [ ] **Account deletion** requirement: in-app path (More → Delete my account) + a public
      web page explaining how to delete the account and data. Deletion itself is
      implemented in the web app (Settings → Security); still to do: a public, logged-out
      help page describing the steps.
- [ ] Permissions: `CAMERA` (barcode scanning, requested at use), `INTERNET`,
      `ACCESS_NETWORK_STATE`. No SMS, contacts, location or storage permissions.
- [ ] Content rating questionnaire (business/productivity, no user-generated public content).
- [ ] Target audience: 18+; not designed for children.
- [ ] Ads: none. Financial features declaration: the app does not provide loans or
      hold money; subscription payments are processed by Razorpay on the web.
- [ ] **Subscriptions & billing:** selling digital subscriptions *inside* the Android app
      must use Google Play Billing (or an approved alternative-billing programme for
      India). The current app has **no purchase flow**; upgrades happen on the web.
      Don't add "Upgrade" buttons that link to web checkout in the app without checking
      current Play payments policy.

## 6. Testing tracks

- [ ] Internal testing (up to 100 testers) → closed testing with 10–20 real shop owners
      → production staged rollout (10% → 50% → 100%).
- [ ] Watch Android vitals (crash rate < 1%, ANR < 0.5%) before widening the rollout.

## 7. Before every release

- [ ] Release notes in English (and Hindi when available).
- [ ] API backwards compatibility: old app versions must keep working against the new
      server for at least one release cycle.
- [ ] Smoke test: sign in, create invoice, issue, share PDF, record payment, scan barcode,
      offline draft → back online → synced.
