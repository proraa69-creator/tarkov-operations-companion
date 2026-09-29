# Tarkov Operator for iOS and Android

The phone app is the same React renderer as the desktop app, packaged with [Capacitor](https://capacitorjs.com)
(`capacitor.config.ts`, native projects in `android/` and `ios/`). It has the same themes, pages and data
(PvP, PvE and Season kept separate) in a phone layout. It **does not read EFT logs or take screenshots**. Those
features stay in the Windows app, which sends its results to the API server. The phone reads them from there.

## What differs on the phone

| Desktop | Phone |
| --- | --- |
| Sidebar + top bar with search | Bottom tab bar: Обзор · Задания · Карты · Мини Карта · Ещё (Барахолка, Торговцы, Галерея, Предметы для Каппы, Профиль, Настройки, поиск, обновить, RU/EN) |
| Task progress from EFT logs | Task progress from the server (`GET /v1/me/progress/:mode`), which the desktop app uploads |
| «Мини Карта»: overlay window, hotkeys, screenshot folder, item OCR | «Мини Карта»: the map the player is on now, with his live position (see below) |
| Collector screen scan | Manual ticks only (synced through the server account) |
| Theme decorations (gear kit, helmet badge, telnyashka still life) | Hidden. The textures and colours of every theme stay |
| Default theme «Тарков» | Default theme «Чёрный мультикам» |

The code gates this with `src/platform.ts`: `isNative()`, `isDesktopShell()`, `isMobileLayout()`. The phone layout
is `<html data-layout="mobile">` + `src/styles/mobile.css`. A desktop browser narrower than 700 px also gets
the phone layout. The Windows app never does.

## Live position («Мини Карта»)

1. The desktop app reads the position from each EFT screenshot and posts it to `POST /v1/me/position/:mode`
   (`{x, y, z, yaw, at, map}`), at most every 2 s (`src/sync/serverSync.ts`).
2. The phone polls `GET /v1/me/position/:mode` every 3 s while «Мини Карта» is open. It stops polling while the app
   is in the background. The mode is the PvP/PvE/Season switch.
3. The map comes from `position.map`. The player arrow shows the heading. The map zooms to the player on the
   first fix and then follows him. Dragging the map stops following, and «Ко мне» turns it back on.
4. A position older than 3 minutes, or no position at all, shows «Не в рейде · нет свежей позиции» on the last
   known map, with a hint that the desktop app must be running and signed in to the same account.

## Connecting the phone to the server

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
3. On the phone: Ещё → Настройки → «Адрес сервера» → `http://192.168.1.20:8787` → Сохранить. Then sign in to the
   same account as in the desktop app («Аккаунт сервера»).

Plain HTTP is accepted only for localhost and private LAN addresses (`10.*`, `172.16–31.*`, `192.168.*`,
`*.local`). Any other address must be HTTPS (`src/sync/webAccount.ts`). Do not expose port 8787 to the internet.
For access from outside the home network, use HTTPS behind a reverse proxy.

Platform settings for LAN HTTP:

- **Android**: `android/app/src/main/res/xml/network_security_config.xml`. Android cannot limit cleartext to IP
  ranges, so cleartext is allowed and the app restricts it itself. For a fixed setup you can pin the PC's IP there.
  `allowMixedContent` is on because the WebView page is `https://localhost`.
- **iOS**: `Info.plist` → `NSAppTransportSecurity/NSAllowsLocalNetworking` (only local-network HTTP is exempt
  from ATS). `NSLocalNetworkUsageDescription` is set in RU/EN (`ru.lproj`/`en.lproj/InfoPlist.strings`). iOS
  asks for local-network access on first use. **Check on a device**: if WKWebView still blocks `http://<LAN IP>`,
  put the server behind HTTPS (for example a local reverse proxy with a certificate the phone trusts).

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
Studio. A release build needs your own signing key (Build → Generate Signed Bundle/APK). Keep the keystore out
of git.

### iOS (macOS only)

Needs a Mac with Xcode 16+, and an Apple Developer account (the paid one to install on devices long-term and to
publish; a free Apple ID can run on your own phone for 7 days).

```bash
npm run mobile:build
npx cap open ios            # opens ios/App/App.xcodeproj (Swift Package Manager, no CocoaPods)
```

In Xcode:

1. Target **App** → Signing & Capabilities → choose your Team. Change the bundle id `com.tarkovoperator.app`
   if it is taken.
2. Pick your iPhone (or a simulator) → Run ▶. Allow local-network access when iOS asks.
3. For TestFlight or the App Store: Product → Archive → Distribute App.

Version: `MARKETING_VERSION` in the Xcode project and `versionName` in `android/app/build.gradle` (both 0.5.4).
The icons are placeholders made by `node scripts/mobile-icons.mjs`. Replace
`ios/App/App/Assets.xcassets/AppIcon.appiconset` and `android/app/src/main/res/mipmap-*` with final artwork.
The splash screens are still the Capacitor defaults.
Orientation: portrait and landscape (the map works in both). Safe areas: `viewport-fit=cover`, and on Android
the Capacitor SystemBars plugin injects `--safe-area-inset-*`. `mobile.css` uses those, or `env()` on iOS.

## Checking in a browser

`npx vite --port 5199` and open it at a width of 700 px or less (DevTools device mode). This gives the phone layout
and the phone's server client. The server must allow that origin in `WEB_ORIGIN`.
