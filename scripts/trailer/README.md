# Trailer generator

The cinematic promo video for the website home page (`website/public/media/`), about 66 s, 1920x1080, 30 fps.
No mouse movement, no cursor, no scrolling walkthrough: clean 2x screenshots of the app with captions, slow
Ken Burns moves, floating cards and cross-fades, in the style of the first 15 s trailer (title scene with the brand
badge and a big gold Oswald title, per-scene captions with a number chip, headline and brass bar, closing call to
action).

Outputs:

| File | What |
| --- | --- |
| `trailer.webm` | 1920x1080, 30 fps, VP8, about 66 s, under 20 MB |
| `trailer-poster.jpg` | 1280x720 title card, used as the `<video poster>` |
| `trailer.mp4` | H.264 high / yuv420p / faststart (plays on iPhone). Needs an ffmpeg with libx264 |

## Scenes

| # | Scene | Content |
| --- | --- | --- |
| 0 | Title | Raid OS badge, title, tagline |
| 1 | Обзор | Quests synced from the game logs, quests of the selected map, items needed for the raid |
| 2 | Карта | Ruler and sniper tools |
| 3 | В рейде | Minimap overlay (position from game screenshots) with the active quests |
| 4 | Маршрут | Route 1-2-3-4-5, the path from quest to quest |
| 5 | Предметы | Item price in the raid, «нужен на Каппу», «НЕ ПРОДАВАТЬ», MATE tag |
| 6 | Сюжет и Капа | Story quests by stage, Collector items window, Kappa progress |
| 7 | Данные | PvP, PvE and Season, separate progress |
| 8 | Боссы | Boss card with HP per body part, boss busts |
| 9 | Телефон | Phone layout at 390 px in a phone frame, marked «скоро» (not in the stores yet) |
| 10 | Синхронизация | PC, website, phone: one account, sign-in by QR |
| 11 | Отряд | Squad, shared quests, map priority, MATE tag |
| 12 | Финал | Raid OS, «Скачать для Windows», tagline, raidos.app |

The honesty rules from `CLAUDE.md` apply to the captions: no claim of live inventory or exact real-time position
(the minimap position comes from game screenshots), the app does not touch the game, and the phone apps are
«скоро». The in-game backdrops behind the overlays are drawn in CSS: no game footage, no Battlestate artwork. Map
image = neutral survey grid, item icons = neutral tile. Squad members, nicknames and the QR link are made up for the
picture. Boss portraits and the 3D boss card are the app's own gallery renders (`website/src/assets/promo`).

## Regenerate

From the repository root:

```bash
npx vite --port 5210                                      # 1. renderer (no Electron needed)
npx vite --config website/vite.config.ts --port 5672      #    and the website (for the site shot)
node scripts/trailer/capture.mjs                          # 2. app → scripts/trailer/shots/*.png (about 4 min)
node scripts/trailer/render.mjs                           # 3. trailer.html → webm + mp4 + poster (about 12 min)
node scripts/trailer/verify.mjs /tmp/frames               # 4. stills from the encoded file, one per scene
```

Stop both vite servers afterwards. `capture.mjs scenegroup ...` re-captures only some groups (`app tools route kappa
story modes boss busts phone squad item minimap site qr`). `render.mjs --preview=scenes --preview-dir=/tmp/p` writes
two stills per scene without encoding, `--preview=12.5,30` writes stills at those times.

Paths assume the sandbox layout: Chromium at `/opt/pw-browsers/chromium` and Playwright's ffmpeg under
`/opt/pw-browsers/ffmpeg-*` (VP8 only). For the mp4 point `TRAILER_FFMPEG` at an ffmpeg with libx264 (it then
produces both files in one pass), or have one on `PATH`. Other overrides: `TRAILER_CHROMIUM`,
`PLAYWRIGHT_BROWSERS_PATH`, `TRAILER_BASE` (renderer, default `http://127.0.0.1:5210/`), `TRAILER_SITE` (website,
default `http://127.0.0.1:5672/`).

## How it works

**`capture.mjs`** opens the renderer in Chromium at 1920x1080 with a device scale of 2, so the Ken Burns zoom stays
sharp, and saves one still per feature.
- It seeds a demo profile per mode (PvP, PvE, Season differ) and adds a «Коллекционер» quest with ten collectible
  items to the demo data, so the Kappa window is not empty.
- Overlays (`#/overlay/item`, `#/overlay/minimap`) use a fake `window.tarkovDesktop` bridge, a transparent page
  and a device scale of 4.
- The squad and Kappa shots use a fake signed-in desktop bridge that answers `/v1/squads/...` and `/v1/friends`
  with a made-up squad of three.
- `*.tarkov.dev` is answered locally with the neutral map grid and item tile.

**`trailer.html`** is the 1920x1080 presentation. A fixed timeline (`T` table near the end) built with the Web
Animations API; scenes are generated from small helpers (`win` crops a region of a still into a framed window,
`captionHtml` builds the eyebrow, headline, bar and pills). To change a caption or the timing, edit it and run
`render.mjs` again; no recapture needed. Fonts are Inter and Oswald (SIL OFL), vendored in `assets/fonts/`. For a
live preview serve this folder over http and open `trailer.html#autoplay` (`file://` blocks the fonts).

**`render.mjs`** steps the timeline with `window.__seek(t)`, screenshots every frame as JPEG and pipes it to ffmpeg:
VP8 at about 2.3 Mb/s (constrained quality) and, when libx264 is available, H.264 crf 22. Deterministic: no dropped
frames, no page-load lead-in.

**`verify.mjs`** checks that Chromium can load the webm (duration, size) and decodes stills with ffmpeg at the given
times (default: the middle of every scene), because headless Chromium paints `<video>` black in screenshots here.

## Older: `promo-video.mjs`

The previous 75 s screen-recording walkthrough (Playwright `recordVideo` with a cursor, captions and the website
scrolling). Kept for reference; it needs the renderer on :5661 and the website on :5672.
