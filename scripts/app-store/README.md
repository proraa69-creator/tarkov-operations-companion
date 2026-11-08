# App Store screenshots

The iPhone app's screenshots for App Store Connect (`docs/app-store/README.md`): the real renderer, run as the App Store
build of the iPhone app, at Apple's exact sizes (6.3″ 1206 × 2622 — required; 6.9″ 1320 × 2868; 6.5″ 1242 × 2688;
and the same turned for landscape), in Russian and English.

```bash
VITE_APP_STORE=1 npx vite --port 5231 --strictPort --host 127.0.0.1   # 1. the renderer as the App Store build
node scripts/app-store/capture.mjs                                     # 2. clean screens → docs/app-store/screenshots/raw/ (PNG, git-ignored)
node scripts/app-store/frame.mjs                                       # 3. captions → docs/app-store/screenshots/<locale>/…, clean JPEGs → …/clean/
node scripts/app-store/check-fields.mjs                                # the text fields of docs/app-store/README.md against Apple's limits
```

Stop the vite server afterwards. `capture.mjs` takes `--locale=ru,en --device=6.3,6.9,6.5 --orient=portrait,landscape
--only=maps,quests`; `APPSTORE_DEBUG=1` writes each screen's text next to it. All of it takes about 40 minutes (two
processes, one per language, halve it). Needs the owner's Customs render (`scripts/trailer/ownMap.mjs`,
`TRAILER_OWN_MAP` to move it).

How the screens are made (`capture.mjs`):

- **iPhone app.** `window.CapacitorCustomPlatform = { name: 'ios' }` makes `isIosApp()` true: the App Store words (no
  subscription, prices or payment), the phone layout in both orientations. The safe areas of each iPhone class are set
  through `--safe-area-inset-*`; portrait shots get the iOS status bar (9:41).
- **Data.** A made-up PvP profile, level 28, real task ids of the live catalog; 17 of 44 Collector items. No account
  is signed in: no e-mail or player nickname on any picture. The clock is set to 13.11.2026 (after the Halloween look,
  `src/theme/halloween.ts`).
- **Network.** GET only to raidos.app (public data; the owner's notice is dropped from `/v1/announcement` and
  `/v1/player-news` is not answered, so nothing covers a screen); every answer cached in `.cache/` (git-ignored), so
  a re-run is offline. Customs is the owner's render; other map drawings a neutral grid (tarkov.dev's maps are
  CC BY-NC-SA, not for an advert).
- **Screens** (`SCREENS`): raid plan, a quest's objectives with the place photo, Customs, Gunsmith (M4A1), the GPU's
  item card, bosses, ballistics, Collector items, «Что собрать для квестов» (Russian only: the English page opens
  empty in this build). Landscape: raid plan, the map full screen, Gunsmith, bosses, ballistics.
