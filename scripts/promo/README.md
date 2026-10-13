# Promo video tooling (social networks)

The 3-minute promo (RU and EN), its 9:16 cut (about 28 s) and the ad images, made from the real app: the renderer of
this repo runs in Chromium with the live tarkov.dev catalog and images, a demo profile, and guide-style tip cards with
pointers and pulsing outlines drawn over it (no background dimming). The voice is placed scene by scene, so the
picture and the voice line up; the music is the repo's own synthesised track (`scripts/trailer/music.mjs`).

Only code and the small demo seeds live here. Media, the owner's clips, voice clips, request caches and outputs stay in
the work folder and are never committed.

## Folders and environment

| Variable | Default | What |
| --- | --- | --- |
| `PROMO_WORK` | the folder holding `promo/` (`scripts/` here) | `promo/src` (the owner's clips), `promo/voice/<lang>` (voice clips `sNN.mp3` + `timing.json`), `promo/netcache` (request cache), `promo/out` (takes and finished files) |
| `RAIDOS_REPO` | this repo | Playwright from `node_modules`, fonts/icon/music from `scripts/trailer` |
| `PROMO_BASE` | `http://127.0.0.1:5211/` | the running Vite dev server of the app (`npm run dev -- --port 5211`) |
| `FFMPEG` | `$PROMO_WORK/bin/ffmpeg`, else `ffmpeg` | ffmpeg 7 |

External requests of the page go through `curl` (`net.mjs`) and are cached in `promo/netcache`, so every take sees
the same catalog and images.

## Steps (from `promo/rec`)

1. Demo profile: `node dump-catalog.mjs` (catalog of the running app), `python3 build-profile.py ru|en` →
   `seed-<lang>.json` (real quest ids, a level-27 USEC with prerequisites done; nothing from a real account).
2. Timeline: `schedule.mjs` builds the global timeline from the voice clips (`promo/voice/<lang>/timing.json`):
   every scene is lead-in + its voice + tail; takes record spans of it.
3. Takes (each is `node <file> <lang>`): `closing/build.mjs <lang> intro` (t01), `takes/t02-overview.mjs`,
   `kappa/build.mjs` (t03, the owner's stash and app clips with the key press), `takes/t04-gunsmith-tasks-maps.mjs`,
   `takes/t05-iteminfo.mjs`, `takes/t06-minimap.mjs` (needs `minimap-payload.mjs` and `minimap/backdrop.mjs` first),
   `takes/t07-squad.mjs`, `takes/t08-bosses.mjs`, `takes/t09a…t09d`, `closing/build.mjs <lang> closing` (t10; the
   phones need `closing/phones.mjs`).
   The recorder (`rec.mjs` + `timewarp.js`) slows the page clock and CSS animations, so the video plays at normal
   speed however slow the machine renders; a take that runs late prints `late by … s`.
4. `node assemble.mjs <lang>` → `promo/out/raidos-promo-<lang>.mp4` (+ `-nomusic`), 1920×1080, 30 fps, −14 LUFS:
   takes cut to exact frame counts, 8-frame dissolves centred on the cuts, voice per scene, music ducked under it.
5. `node vertical/build.mjs <lang>` → `promo/out/raidos-vertical-<lang>.mp4`, 1080×1920: logo card with the scene-1
   voice, six crops of the finished video with big captions, the end card with the scene-20 voice. The browser draws
   every whole frame and pipes it to one encoder (multi-input ffmpeg graphs stalled in ffmpeg 7.0 here).
6. `node ads/build.mjs <lang>` → `promo/out/ads-<lang>/`: cover 1920×1080, squares 1080×1080 (Kappa, item, minimap),
   feed 1080×1350, story 1080×1920, from frames in `ads/frames-<lang>/`.

Texts of the tip cards: `texts.mjs`; the voice script with the English version: `script-ru-en.md`.

## Rules kept by the video

- Only what the app really does: no live inventory or in-raid position reading is shown as real; the minimap scene is
  marked as an example over a drawn game backdrop.
- PvP, PvE and Season stay separate in the demo profile.
- No third-party music; the voice is the owner-approved clone (generated outside this tooling).
