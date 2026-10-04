# Trailer generator

The cinematic promo video for the website home page (`website/public/media/`), about 61 s, rendered at 1920x1080,
shipped as 720p. No mouse movement, no cursor, no scrolling walkthrough: clean 2x screenshots of the app with captions,
slow Ken Burns moves, floating cards and cross-fades. The ten feature scenes follow the website's «Десять причин» list
in the same order and with the same numbers.

Outputs:

| File | What |
| --- | --- |
| `trailer.mp4` | H.264 high, 1280x720, 30 fps, yuv420p, faststart, about 3 MB (shipped inside the server exe: keep it small) |
| `trailer-poster.jpg` | 1280x720 title card, used as the `<video poster>` |
| `scripts/trailer/trailer.webm` | only with `render.mjs --webm`: 1080p VP8, not shipped |

## Scenes

| # | Scene | Content |
| --- | --- | --- |
| 0 | Title | Raid OS badge, title, «Задания · Карты · Цены · Отряд» |
| 01 | Обзор | Quests of the selected map, the plan for the raid, raid requirements |
| 02 | Цена в рейде | Item price in the raid with the «Каппа» tag, MATE tag |
| 03 | Сюжетные квесты | Story chapter and its stages, automatic sync |
| 04 | Путь к Каппе | Items for the Collector (scan the stash), Kappa progress, the in-raid «Каппа» card |
| 05 | Данные | PvP, PvE and Season, separate progress |
| 06 | Боссы | Boss card with HP per body part, boss busts |
| 07 | Баллистика | Penetration/damage chart, 7.62×39 BP against armor classes 1–6 |
| 08 | Телефон | Phone layout at 390 px in a phone frame, marked «скоро» (not in the stores yet) |
| 09 | Синхронизация | PC, website, phone: one account, sign-in by QR |
| 10 | Отряд | Squad, shared quests, map priority, MATE tag |
| 11 | Финал | Raid OS, «Скачать для Windows», tagline, raidos.app |

The honesty rules from `CLAUDE.md` apply to the captions: no claim of live inventory or exact real-time position, the
app does not touch the game, and the phone apps are «скоро». The captions do not explain how the app gets its data
(no logs, screenshots or screen reading — the owner's request, 04.10.2026); the story page's hint line about it is
hidden in the capture. The in-game backdrop behind the item cards is drawn in CSS: no game footage, no Battlestate
artwork. Map image = neutral survey grid, item icons = neutral tile. Squad members, nicknames and the QR link are made up
for the picture. The ammo on the ballistics shot is the repository's tarkov.dev fixture (16 real rounds). Boss portraits
and the 3D boss card are the app's own gallery renders (`website/src/assets/promo`).

## Regenerate

From the repository root:

```bash
npx vite --port 5210                                      # 1. renderer (no Electron needed)
npx vite --config website/vite.config.ts --port 5672      #    and the website (for the site shot)
node scripts/trailer/capture.mjs                          # 2. app → scripts/trailer/shots/*.png (about 4 min)
node scripts/trailer/render.mjs                           # 3. trailer.html → 720p mp4 + poster (about 10 min)
```

Stop both vite servers afterwards. `capture.mjs scenegroup ...` re-captures only some groups (`app kappa story modes
boss ballistics busts phone squad item site qr`). `render.mjs --preview=scenes --preview-dir=/tmp/p` writes two stills
per scene without encoding, `--preview=12.5,30` writes stills at those times. The capture also writes the website's
stills `ballistics-site.png` and `story-site.png` (converted to `website/src/assets/promo/*.webp` at 1200 px wide).

Paths assume the sandbox layout: Chromium at `/opt/pw-browsers/chromium`. The mp4 needs an ffmpeg with libx264:
`TRAILER_FFMPEG`, or one on `PATH` (Playwright's bundled ffmpeg under `/opt/pw-browsers/ffmpeg-*` is VP8 only and is
used for `--webm`). Other overrides: `TRAILER_CHROMIUM`,
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
H.264 crf 27 scaled to 1280x720 (and VP8 at about 2.3 Mb/s with `--webm`). Deterministic: no dropped frames, no
page-load lead-in.

To check the encoded mp4, decode stills with ffmpeg (headless Chromium paints `<video>` black in screenshots here),
e.g. `ffmpeg -ss 37.5 -i website/public/media/trailer.mp4 -frames:v 1 /tmp/t.png` for the middle of a scene
(`window.__times` in trailer.html). **`verify.mjs`** does the same for the optional `--webm` file.

## Older: `promo-video.mjs`

The previous 75 s screen-recording walkthrough (Playwright `recordVideo` with a cursor, captions and the website
scrolling). Kept for reference; it needs the renderer on :5661 and the website on :5672.
