# Raid OS for iOS and Android

The phone app is the same React renderer as the desktop app, packaged with [Capacitor](https://capacitorjs.com)
(`capacitor.config.ts`, native projects in `android/` and `ios/`). It has the same themes, pages and data
(PvP, PvE and Season kept separate) in a phone layout. It **does not read EFT logs or take screenshots**. Those
features stay in the Windows app, which sends its results to the API server. The phone reads them from there.

## What differs on the phone

| Desktop | Phone |
| --- | --- |
| Sidebar + top bar with search | Bottom tab bar: Обзор · Квесты · Карты · Оружейник · Ещё (Барахолка, Торговцы, Баллистика, Боссы, Предметы для Каппы, Отряд, Профиль, Настройки, поиск, обновить, RU/EN, the app version) |
| Task progress from EFT logs | Task progress from the server (`GET /v1/me/progress/:mode`), which the desktop app uploads |
| «Мини Карта»: overlay window, hotkeys, screenshot folder, item OCR | No «Мини Карта» tab (owner, 13.10.2026): «Карты» show the player's position (see below) |
| Overview: rows and two columns, blocks dragged with the mouse | One column; «Настроить блоки» moves every block with ↑ / ↓, «Текущие задания» and «Прогресс» can stand side by side (`src/overview/phoneLayout.ts`) |
| Quests: the card next to the list | A tap opens the quest's card as a sheet over the list |
| Collector screen scan | Manual ticks only (synced through the server account) |
| Theme decorations (gear kit, helmet badge, telnyashka still life) | Hidden. The textures and colours of every theme stay |
| Default theme «Олива» (id `tarkov`) | Default theme «Олива» (the same; until 08.10.2026 the phone started on «Чёрный мультикам») |

The code gates this with `src/platform.ts`: `isNative()`, `isDesktopShell()`, `isMobileLayout()`. The phone layout
is `<html data-layout="mobile">` + `src/styles/mobile.css`. A desktop browser narrower than 700 px also gets
the phone layout. The Windows app never does.

## Live position («Карты»)

1. The desktop app reads the position from each EFT screenshot and posts it to `POST /v1/me/position/:mode`
   (`{x, y, z, yaw, at, map}`), at most every 2 s (`src/sync/serverSync.ts`).
2. The phone polls `GET /v1/me/position/:mode` every 3 s while «Карты» are open (`src/mobile/PhoneMapsPage.tsx`).
   It stops polling while the app is in the background. The mode is the PvP/PvE/Season switch.
3. A new fresh position (the player took a screenshot in the game) opens the map it names (`position.map`) and the
   player arrow shows the heading. The map zooms to the player on the first fix and then follows him; dragging the
   map stops following until the next new position. Any other map can be looked at in between.
4. A position older than 3 minutes is drawn dimmed and does not move the map.

## Connecting the phone to the server

Normal builds use `https://raidos.app` (HTTPS only). A server in the home network over plain HTTP is a development
setup: on Android it needs a build made with `RAIDOS_MOBILE_DEV_HTTP=1` (see «Platform settings» below).

The phone cannot reach `127.0.0.1` of the PC. It needs the PC's address in the same Wi-Fi network:

1. On the PC, find the LAN address (`ipconfig` → IPv4, e.g. `192.168.1.20`).
2. Start the API server listening on the network. It refuses a network listener without a token:
   ```powershell
   $env:HOST = '0.0.0.0'; $env:PORT = '8787'
   $env:TARKOV_API_TOKEN = '<a long random string>'
   $env:WEB_ORIGIN = 'https://localhost,capacitor://localhost,http://localhost:5173'
   npm --prefix server start
   ```
   Windows asks whether to allow Node.js on private networks. Allow it for **private** networks only. This is a
   firewall change: do it yourself, the agent does not change firewall settings.
3. The phone has no «Адрес сервера» setting any more (owner, 13.10.2026). Build it for the LAN server with
   `VITE_TARKOV_API_URL=http://192.168.1.20:8787`, or sign in with the QR code of a desktop app that uses that
   server (the QR brings its server along). Then sign in to the same account as in the desktop app («Аккаунт сервера»).

Plain HTTP is accepted only for localhost and private LAN addresses (`10.*`, `172.16–31.*`, `192.168.*`,
`*.local`). Any other address must be HTTPS (`src/sync/webAccount.ts`). Do not expose port 8787 to the internet.
For access from outside the home network, use HTTPS behind a reverse proxy.

Platform settings for LAN HTTP:

- **Android**: `android/app/src/main/res/xml/network_security_config.xml`. Android cannot limit cleartext to IP
  ranges, so cleartext is allowed and the app restricts it itself. For a fixed setup you can pin the PC's IP there.
  The WebView page is `https://localhost`, so calls to a plain-HTTP server are mixed content: Capacitor's
  `allowMixedContent` is off in normal builds and they are blocked. A development build for a LAN server turns it
  on: `RAIDOS_MOBILE_DEV_HTTP=1 npm run mobile:build` (or `RAIDOS_MOBILE_DEV_HTTP=1 npm run android:apk`); `cap sync`
  writes the value into the native project (`capacitor.config.ts`).
- **iOS**: `Info.plist` → `NSAppTransportSecurity/NSAllowsLocalNetworking` (only local-network HTTP is exempt
  from ATS). `NSLocalNetworkUsageDescription` is set in RU/EN (`ru.lproj`/`en.lproj/InfoPlist.strings`). iOS
  asks for local-network access on first use. **Check on a device**: if WKWebView still blocks `http://<LAN IP>`,
  put the server behind HTTPS (for example a local reverse proxy with a certificate the phone trusts).

## QR sign-in

Nobody types a password on the phone:

- **Desktop → phone.** Windows app → Профиль оператора → «Войти в мобильную версию» shows a QR code with
  `https://<site>/app-login#login=<code>&server=<site>`. The code is made by the server
  (`POST /v1/accounts/me/login-codes`), lives 2 minutes, works once and is stored only as a SHA-256 hash. The
  long-lived session token never leaves the desktop main process. The phone camera opens the website page; its
  «Открыть в приложении» button starts the app with `tarkovoperator://login?code=…&server=…` (Android: an `intent://`
  link that falls back to the website). The app asks «Войти в аккаунт?», switches to that server and exchanges the
  code for its own session (`POST /v1/accounts/login-codes/redeem`). Without the app, «Войти на сайте» signs in to
  the website cabinet instead.
- **Website → phone or desktop.** The website's login page → «Войти по QR-коду» shows a QR code and a short code
  (`XXXX-XXXX`, 2 minutes). A signed-in phone scans it (`/app-login#approve=…` → `tarkovoperator://approve?…`), or the
  desktop app takes the typed code (Профиль → «Подтвердить вход на сайте»). The approving app first shows which
  browser asks (`inspect`) and signs in only after «Разрешить вход». The browser polls with a secret only it knows and
  gets a new session once. A phone browser already signed in to the site can approve right on the page.

Server side: `server/src/services/loginCodes.ts` (in memory, hashed, rate limited per IP and per account; tests in
`server/src/routes/loginCodes.test.ts`). Phone side: `src/mobile/deepLink.ts` (parser, tests) and
`src/mobile/DeepLinkLogin.tsx` (`@capacitor/app` `appUrlOpen` / `getLaunchUrl`). The scheme is registered in
`android/app/src/main/AndroidManifest.xml` (intent filter) and `ios/App/App/Info.plist` (`CFBundleURLTypes`);
`npm run mobile:build` (cap sync) wires the `@capacitor/app` plugin into both projects.

The phone's default server is `https://raidos.app` (the owner's permanent address; `VITE_TARKOV_API_URL` overrides it
at build time). After signing in, nicknames saved on the account are bound on the phone automatically.

**Not verified on a device yet:** opening the app from the camera on Android and iOS (needs a signed APK / Xcode build).

## Build

Common step (any OS):

```bash
npm install
npm run mobile:build        # vite build → dist/, then npx cap sync (copies dist into android/ and ios/)
```

### Android (Windows, macOS or Linux)

Needs Android Studio (Android SDK 36, JDK 21).

```bash
npm run android:apk         # cap sync android + cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

On Windows use `cd android && gradlew.bat assembleDebug`. Or run `npx cap open android` and use Run ▶ in Android
Studio.

A build for players is a **release** build signed with the app's key (not debuggable). The key is given through the
environment and never comes from git (`android/app/build.gradle`):

```bash
RAIDOS_ANDROID_KEYSTORE=/path/raidos-release.p12 RAIDOS_ANDROID_KEYSTORE_PASSWORD=… \
RAIDOS_ANDROID_KEY_ALIAS=raidos RAIDOS_ANDROID_KEY_PASSWORD=… \
  npm run mobile:build && cd android && ./gradlew assembleRelease testReleaseUnitTest
# → android/app/build/outputs/apk/release/app-release.apk
```

Without the variables `assembleRelease` gives an unsigned APK. **Every APK given to players must be signed with the
same key**: Android installs an update only over a build signed by the same key, so a lost key means every player
uninstalls the app and installs it again. Keep the keystore and its password outside the repository, in two places.

`versionName` and `versionCode` come from `package.json` (`scripts/set-version.mjs`): «0.6.0-29» → `0.6.0.29`,
`600029` (major·10 000 000 + minor·100 000 + patch·1 000 + the fourth number), so every release installs over the
previous one.

### Обновление Android-версии (in-app update from the site)

The Android app updates itself from the site, without Google Play (owner, 13.10.2026: «добавь туда автообновление
внутри приложения… оно будет у нас на сайте»):

1. At start, and back from the background after 12 hours, the app reads
   `https://raidos.app/download/android/version.json` (`src/mobile/androidUpdate.ts`).
2. A newer `versionCode` downloads by itself on Wi-Fi; on mobile data the card above the tab bar offers «Скачать»
   (Settings → «Скачивать обновления автоматически» turns the automatic download off).
3. The native side (`android/app/src/main/java/com/tarkovoperator/app/ApkUpdaterPlugin.java`, `UpdateDownload.java`)
   fetches only HTTPS files under `raidos.app/download/android/` (no redirects) and checks the size, the SHA-256 from
   `version.json`, the package name, the version and the signing certificate before anything is offered.
4. «Обновление готово к установке» → «Установить» opens Android's installer; the player confirms. The first time
   Android asks to allow installs from Raid OS («Разрешить из этого источника»); back in the app the installation
   continues. Nothing installs without the player's tap, so an update never closes the app in a raid. The card is
   not shown on «Мини Карта».

`version.json` (at most 64 KB; the app refuses anything else):

```json
{ "versionCode": 600030, "versionName": "0.6.0.30", "url": "https://raidos.app/download/android/raid-os-0.6.0.30.apk",
  "sha256": "<64 hex>", "size": 98765432 }
```

To publish (only on the owner's word — nothing is on the site yet, and until then the app says «Обновлений на сайте
пока нет»):

```bash
node scripts/android-release.mjs android/app/build/outputs/apk/release/app-release.apk out/android
# → out/android/raid-os-<version>.apk and out/android/version.json
```

Upload both to `/download/android/` of the site: the APK first, `version.json` last. The VPS publisher
(`release/production`) does not carry them: its path policy (`docs/coordination/ops-reference/release-policy.mjs`)
refuses `android/` and `ios/` files, so Android changes live on their own branch until that policy treats them as
not deployed (like `docs/`). A Google Play build must not contain this updater (Play forbids updates from other
sources): drop `REQUEST_INSTALL_PACKAGES` and the plugin there.

App data is never in an Android backup or a device-to-device transfer (`android:allowBackup="false"`,
`res/xml/data_extraction_rules.xml`): the WebView storage holds the account session token. A new phone signs in
again (QR sign-in).

### iOS

Local native development needs a Mac with Xcode 26+ (Capacitor 8), and an Apple Developer account (the paid one to
install on devices long-term and to publish; a free Apple ID can run on your own phone for 7 days).

```bash
npm run mobile:build
npx cap open ios            # opens ios/App/App.xcodeproj (Swift Package Manager, no CocoaPods)
```

In Xcode:

1. Target **App** → Signing & Capabilities → choose your Team. Change the bundle id `com.tarkovoperator.app`
   if it is taken.
2. Pick your iPhone (or a simulator) → Run ▶. Allow local-network access when iOS asks.
3. For TestFlight or the App Store: Product → Archive → Distribute App.

The owner can build without a local Mac. A push to `release/production` runs `.github/workflows/ios-ipa.yml` on a
GitHub-hosted macOS runner after renderer checks. It builds the exact release commit without signing and uploads
`Raid-OS-iOS-<version>-<sha>.ipa` plus its SHA-256 file as a 14-day Actions artifact. Download that artifact on
Windows and install the IPA with Sideloadly, which applies the owner's personal Apple ID signature. No Apple
credentials or certificates are stored in this repository or GitHub Actions.

Version: `MARKETING_VERSION` in the Xcode project (0.5.4 until the next phone build); Android takes it from `package.json`.
Icons and splash screens are the «Raid OS» artwork (`build/brand/*.svg`), generated by `node scripts/brand-icons.mjs`
together with the Windows icon: `ios/App/App/Assets.xcassets/AppIcon.appiconset` (1024 px, no transparency),
`Splash.imageset`, and on Android `mipmap-*` (legacy `ic_launcher` / `ic_launcher_round`, adaptive
`ic_launcher_foreground` + `ic_launcher_background` — the monogram sits inside the 66 % safe zone) and `drawable*/splash.png`.
The app is called «Raid OS»; the bundle id `com.tarkovoperator.app` and the `tarkovoperator://` sign-in links stay
(renaming the id would make it a different app for the stores and for installed phones). `raidos://` works as an alias.
Orientation: portrait and landscape (the map works in both). Safe areas: `viewport-fit=cover`, and on Android
the Capacitor SystemBars plugin injects `--safe-area-inset-*`. `mobile.css` uses those, or `env()` on iOS.

## Checking in a browser

`npx vite --port 5199` and open it at a width of 700 px or less (DevTools device mode). This gives the phone layout
and the phone's server client. The server must allow that origin in `WEB_ORIGIN`.
