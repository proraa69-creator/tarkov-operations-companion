# Trailer generator

Makes the 15-second promo video for the website home page from real screens of the app.

Outputs (in `website/public/media/`):

| File | What |
| --- | --- |
| `trailer.webm` | 1920×1080, 30 fps, VP8, 15.0 s, about 8 MB |
| `trailer-poster.jpg` | 1280×720 title card, used as the `<video poster>` |
| `trailer.mp4` | H.264/yuv420p/faststart. Only made when a full `ffmpeg` with libx264 is on `PATH` |

## Regenerate

From the repository root:

```bash
npx vite --port 5210              # 1. renderer, in a second terminal (no Electron needed)
node scripts/trailer/capture.mjs  # 2. click through the app → scripts/trailer/shots/*.png
node scripts/trailer/render.mjs   # 3. trailer.html → trailer.webm + trailer-poster.jpg (~2.5 min)
node scripts/trailer/verify.mjs /tmp/frames 1,5,10,14   # 4. stills from the encoded file
```

Stop the vite server afterwards.

Paths assume the sandbox layout: Chromium at `/opt/pw-browsers/chromium` and Playwright's ffmpeg under
`/opt/pw-browsers/ffmpeg-*`. Override them with `TRAILER_CHROMIUM`, `TRAILER_FFMPEG` or
`PLAYWRIGHT_BROWSERS_PATH`. Set `TRAILER_BASE` if the renderer is not on `http://localhost:5210/`.

## How it works

**`capture.mjs`** opens the renderer in Chromium and saves screenshots at 2× (3840×2160), so the Ken Burns
zoom stays sharp.
- It seeds a demo profile in `localStorage` (3 finished and 5 active Customs quests, favourites), so the
  pages are not empty.
- It turns on the "Новые иконки" map markers (`tarkov-map-marker-style=modern`) and uses the ruler and sniper
  tools on `#/maps/customs`.
- For the colour themes it sets `tarkov-app-theme` to `steel` and `crimson`.
- The overlays (`#/overlay/item`, `#/overlay/minimap`) are rendered with a fake `window.tarkovDesktop` bridge
  and captured on a transparent background.
- tarkov.dev is not reachable from the build machine, so the app falls back to its built-in demo data.
  Requests to `*.tarkov.dev` are answered locally: item icons become a plain dark tile and the map image
  becomes a dim survey grid. The shots never show broken images, and no game art is used.
- `#/kappa-items` is captured, but the trailer does not use it. With demo data the Collector quest is
  missing, so the page is empty.

**`trailer.html`** is the 1920×1080 presentation. The timeline is fixed and built with the Web Animations
API:

| Time | Beat |
| --- | --- |
| 0–2.3 s | Title card |
| 2.0 s | Maps: ruler → sniper |
| 4.0 s | Minimap overlay |
| 6.0 s | Item price overlay |
| 8.0 s | Quests |
| 9.8 s | Flea market |
| 11.5 s | Theme wipes |
| 13.05–15 s | «Скачать приложение» outro |

The in-game backdrop behind the overlays (haze, ridge line, compass strip, stash grid) is drawn in CSS.
There is no game footage or Battlestate artwork. Fonts are Inter and Oswald (SIL OFL), vendored in
`assets/fonts/`. To preview it live, serve this folder over http and open `trailer.html#autoplay`.
Opening it from `file://` blocks the fonts.

**`render.mjs`** steps the timeline frame by frame with `window.__seek(t)`, screenshots each frame as JPEG,
and pipes the frames into Playwright's bundled ffmpeg (VP8, about 4.5 Mb/s). The result is deterministic,
with no dropped frames and no load-time lead-in. Other options:
- `--realtime` records the page with Playwright `recordVideo` instead, trims the lead-in and re-encodes.
- `--preview=1,5.5,10 --preview-dir=/tmp/x` saves stills of the timeline without encoding.

**`verify.mjs`** checks that Chromium can load the webm (duration and size). It then decodes stills with the
bundled ffmpeg, because headless Chromium paints `<video>` black in screenshots on this machine.

To change a caption or the timing, edit `trailer.html` (see the `T` table and the calls below it), then run
`render.mjs` again. You don't need to recapture.
