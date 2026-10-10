# Trailer generator

The cinematic promo video for the website home page (`website/public/media/`), about 64 s, rendered at 1920x1080,
shipped as 720p. Clean 2x screenshots of the app (and the owner's own screenshots) with captions, slow camera moves,
floating cards and cross-fades; the only pointer is the one hovering the boss health card. v3 follows the owner's
storyboard of 10.10.2026 (about a minute, «Тарков» colours).

Outputs:

| File | What |
| --- | --- |
| `trailer.mp4` | H.264 high, 1280x720, 30 fps, yuv420p, faststart, about 4–5 MB (shipped inside the server exe: keep it small) |
| `trailer-poster.jpg` | 1280x720 title card, used as the `<video poster>` |
| `scripts/trailer/trailer.webm` | only with `render.mjs --webm`: 1080p VP8, not shipped |

## Scenes

| # | Scene | Content |
| --- | --- | --- |
| 0 | Title | Raid OS badge, «Полевой компаньон», «Задания · Карты · Цены · Отряд» |
| 01 | Обзор | «Квесты синхронизируются сами» over the owner's overview screenshot panned top → bottom; marked blocks: «Приоритет карт», «Отслеживание Кочевников», «Текущие задания», «Карта со всеми точками квестов», «Предметы, требуемые в рейде» |
| 02 | Цена в рейде | «Продать или оставить?»: a 6x6 stash with items cut out of the owner's stash screenshot; the Viibiin sneaker shows its card with «Каппа», the GPU its card with MATE (prices: see below) |
| 03 | Режимы | PvP → PvE → Сезон: the switch slides, the overview of each mode behind it («у каждого своя база») |
| 04 | Путь к Каппе | The owner's Collector page: a scan sweep, «8 / 44» marked, the Viibiin cell marked and its in-raid «Каппа» card |
| 05 | Отряд | Members, «Квесты по картам» (each member's quests per map, shared quests and who has them; the board zooms into the first maps) |
| 06 | Боссы | Quick cuts through Решала, Килла, Глухарь, Кабан, then Тагилла turning a full 360° (120 frames played at 30 fps, rigid: no cloth physics) while a pointer hovers the health card: head, thorax, left leg light up |
| 07 | Патроны и барахолка | Penetration/damage chart of all rounds, «Против брони · BP» (chance per armor class), the GPU's flea prices for the mode |
| 08 | Мини-карта | The whole minimap overlay over the game (map, floors, sliders, quest list): the player's point pulses, quest points nearby |
| 09 | Обновления | The auto-update window («всегда свежая версия») |
| 10 | Темы | «Смена темы — в один клик»: the pointer clicks the top-bar palette button five times, the overview cycles Олива → Чёрный мультикам → Металл → Тельняшка → Снаряжение → Олива (shots `theme-<id>.png`, capture group `themes`) |
| 11 | Телефон | iOS and Android «скоро», sign-in by QR |
| 12 | Синхронизация | PC, website, phone: one base, the position on the phone |
| 13 | Честная игра | Raid OS does not inject into EFT, read its memory, automate actions or bypass protection |
| 14 | Финал | Raid OS, «Скачать для Windows», raidos.app |

The honesty rules from `CLAUDE.md` apply to the captions: no claim of live inventory, the app does not touch the game,
the phone apps are «скоро». The captions do not explain how the app gets its data (the owner's request, 04.10.2026).
`owner/` holds the owner's screenshots (overview, stash, Collector page; chat 10.10.2026), used as they are;
the item icons of scene 02 are cut out of `owner/stash.webp` (the GPU and LEDX pictures also stand in for the app's
tarkov.dev icons). The in-game backdrop behind the overlay cards is drawn in CSS (no game footage). Map images are a
neutral 10 m survey grid: tarkov.dev is not reachable from the capture sandbox, and its maps are CC BY-NC-SA
(non-commercial), so they are not used in an advert. The flea shot hides the sandbox's «демо-данные» notes (there is no
live price source here) and the empty price history.

Prices on screen (10.10.2026): Viibiin — flea 55 908 ₽ (Tarkov Forge, live), Терапевт 28 939 ₽; GPU — flea PvP 344 000 ₽ /
PvE 739 000 ₽ (Tarkov Forge 7-day average to 30.09.2026), Терапевт 124 740 ₽.
Squad members, nicknames and the QR link are made up for the picture. The ammo on the ballistics shot is the
repository's tarkov.dev fixture (16 real rounds).

## Advert (31 s) with music

`trailer.html?cut=ad` plays a 31 s cut for social networks: logo, quests sync, «Продать или оставить?», bosses (three quick
cuts, a full turn of Tagilla in 2 s, the pointer on the health card), «Общие квесты на картах», the minimap, «Смена
темы» (five clicks on the palette button), PC · site · phone, fair play, the end card. Captions are numbered in the advert's own order (both cuts number them by play order); a Raid OS badge sits in the
bottom-right corner while the features play. Scene changes fall on beats of the music.

```bash
node scripts/trailer/render.mjs --cut=ad --music   # → scripts/trailer/out/raidos-ad-silent.mp4 and raidos-ad-music.mp4 (1080p)
```

`music.mjs` synthesises the soundtrack from the cut's cues (`out/raidos-ad.cues.json`, written by render.mjs): a dark
120 BPM electronic bed in D minor (Dm–B♭–F–C) — half-time drums from the first scene change, four on the floor from the
bosses, a break with a snare roll and a riser on «Честная игра», an impact on the logo and on the end card, whooshes on
scene changes, ticks when cards pop. Everything is generated sample by sample (no recordings or samples), so the music
has no licence attached. render.mjs brings it to −14 LUFS (ffmpeg loudnorm, two passes) and muxes AAC 192 kb/s.
`out/` is not committed.

## Regenerate

From the repository root:

```bash
npx vite --port 5210                                      # 1. renderer (no Electron needed)
npx vite --config website/vite.config.ts --port 5672      #    and the website (for the site shot)
node scripts/trailer/capture.mjs                          # 2. app → scripts/trailer/shots/*.png (about 20 min: the 360° turn is slow)
node scripts/trailer/render.mjs                           # 3. trailer.html → 720p mp4 + poster (about 10 min)
```

Stop both vite servers afterwards. `capture.mjs scenegroup ...` re-captures only some groups (`app stash item modes squad
themes bossstill boss3d bosshp ballistics flea minimap update phone live site qr`); `boss3d` alone takes about 10 min
(120 frames of software WebGL). `render.mjs --preview=scenes --preview-dir=/tmp/p` writes two stills
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
