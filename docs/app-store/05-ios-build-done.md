# iOS App Store build — what is done (17.10.2026)

Companion to the owner's 01–04 files (`04-ios-build-spec.md`). This file covers the iPhone app only; Windows, the
website and Android are unchanged.

## In the app (iOS only: `isIosApp()` / `APP_STORE_BUILD` in `src/platform.ts`)

- **No payments.** The paywall becomes «Нет доступа» with «Обновить», «Поддержка» (Telegram), «Выйти», the privacy policy
  and «Удалить аккаунт» (`src/account/IosAccount.tsx`). There are no plans, prices, «Оплатить» button, links to payment on
  the site, «Пригласи друга» discounts, invitation codes, free-day promises or «+1 день» rewards, and no subscription chip
  or renewal window. The «Личный кабинет» (site cabinet) and the streamer cabinet with payouts are replaced by
  «Аккаунт» (e-mail, «Доступ открыт до …», nickname, phone, e-mail confirmation). «Поддержать проект» (donations) is hidden.
  Friends, squad and quest search say «недоступно» instead of «функция подписки».
- **Account deletion.** «Профиль → Удаление аккаунта» and the «Нет доступа» screen: the password confirms it, then
  `POST /v1/accounts/me/delete` (the server route the website already uses) and the phone signs out.
  Every account has a password: registration always sets one, and SMS or e-mail codes only sign in to an existing account
  or reset its password. A player who signs in by phone and forgot the password resets it on the sign-in screen first
  (the dialog says so). An account the server refuses because of an active website autopayment gets «Напишите в поддержку».
- **Privacy policy:** `https://raidos.app/legal/privacy` from the profile, the «Нет доступа» screen and the deletion screen
  (the registration consent links to it too).
- **No admin tools or downloaded code.** The «Админ-панель» menu entry and `/admin` routes are off on iOS, and the App
  Store build replaces the admin pages with empty modules (`vite.config.ts` `appStoreStubs`), so their code is not in the
  bundle. The interface ships inside the app (`webDir: dist`, no `server.url`); the iPhone app never downloads code or
  updates itself.
- **Reviewer sign-in:** e-mail + password in the app (Профиль or the start screen). The account given to Apple needs open
  access («Доступ открыт»), otherwise the reviewer sees only «Нет доступа».

## Native project (`ios/App`)

- `Info.plist`: `ITSAppUsesNonExemptEncryption = false`; camera and photo library texts in English (base) with Russian in
  `ru.lproj/InfoPlist.strings`; no iPad orientations.
- `PrivacyInfo.xcprivacy` (added to the target's resources): no tracking; e-mail, phone, user ID, gameplay content, other
  user content and diagnostics — linked to the user, app functionality only; UserDefaults reason CA92.1.
  **Check it against `03-privacy-labels.md`** (that file was not in the repository) and the App Privacy answers.
- `TARGETED_DEVICE_FAMILY = 1` (iPhone only); `MARKETING_VERSION = 0.6.0`; the build number comes from CI.

## Signed build and TestFlight

`.github/workflows/ios-app-store.yml` builds with `VITE_APP_STORE=1`, archives with automatic signing through an App Store
Connect API key, checks the archive (bundle id, encryption flag, iPhone only, privacy manifest, no admin code) and uploads
to TestFlight. It runs on `release/production` (with the owner's go) and does nothing until these repository secrets
exist (GitHub → Settings → Secrets and variables → Actions):

| Secret | What |
| --- | --- |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APP_STORE_CONNECT_KEY_ID` | API key ID (App Store Connect → Users and Access → Integrations → Keys) |
| `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID from the same page |
| `APP_STORE_CONNECT_KEY_P8_BASE64` | the downloaded `AuthKey_XXXX.p8`, base64 (`base64 -i AuthKey_XXXX.p8`), role App Manager or Admin |

The app record `com.tarkovoperator.app` must exist in App Store Connect before the first upload.

## Screenshots (iPhone 6.9", 1320 × 2868)

Draft screenshots of Overview, Maps, Gunsmith, Bosses and Weapon builds were taken from the same interface at the 6.9"
size, signed out. The final set is best taken on the TestFlight build with the reviewer account, so quests and progress
are filled in.

## Review notes (paste into App Store Connect → App Review Information)

> Raid OS is a companion app for the PC game Escape from Tarkov: quests, maps, bosses, weapon builds and the flea market.
> Accounts are created in the app (e-mail + password) or on raidos.app. The app does not sell anything and contains no
> purchases or links to purchases. Demo account: <e-mail> / <password>. Account deletion: Profile → «Удалить аккаунт».
> Privacy policy: https://raidos.app/legal/privacy.

## Remaining risks

- The owner's notices and surveys come from the server and show in the iPhone app too: a notice about prices or discounts
  would reach App Review. Target such notices away from iOS (or keep them free of prices) while the app is in review.
- The registration consent links to the offer (оферта) on the site, which describes payments. It is a legal document,
  not a purchase link, but a strict reviewer may ask.
- Guideline 3.1.1 / 3.1.3: a subscription service with no in-app purchase relies on the app showing no purchase path at
  all; that is what this build does.
