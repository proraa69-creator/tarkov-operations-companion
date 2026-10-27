# Trailer generator

The cinematic promo video for the website home page (`website/public/media/`), 68 s, rendered at 1920x1080,
shipped as 720p. Clean 2x screenshots of the app (and the owner's own screenshots) with captions, slow camera moves,
floating cards and cross-fades; the only pointer is the one hovering the boss health card. v3 follows the owner's
storyboard of 10.10.2026 (about a minute, «Тарков» colours); v4 (16.10.2026) shows nothing over the game: since
15.10.2026 the app draws nothing there, so the stash with item cards, the minimap overlay and the in-raid «Каппа» card
are gone, and the item card and the player's point are shown where they are now, on the app's «Карты», plus «Оружейник».

Outputs:

| File | What |
| --- | --- |
| `trailer.mp4` | H.264 high, 1280x720, 30 fps, yuv420p, faststart, about 4–5 MB (shipped inside the server exe: keep it small) |
| `trailer-poster.jpg` | 1280x720 title card, used as the `<video poster>` |
| `scripts/trailer/trailer.webm` | only with `render.mjs --webm`: 1080p VP8, not shipped |

## Scenes

| # | Scene | Time (s) | Content |
| --- | --- | --- | --- |
| 0 | Title | 0–2.6 | Raid OS badge, «Полевой компаньон», «Задания · Карты · Цены · Отряд» |
| 01 | Обзор | 2.3–7.9 | «Квесты синхронизируются сами» over the owner's overview screenshot panned top → bottom; marked blocks: «Приоритет карт», «Отслеживание Кочевников», «Текущие задания», «Карта со всеми точками квестов», «Предметы, требуемые в рейде» |
| 02 | Предмет | 7.5–13.1 | «Информация о предмете — прямо на карте»: «Карты» on Customs, the camera moves in on the item card under «Вид» (MapItemCard): the Golden egg with its picture, flea / Терапевт prices, «Каппа: нужен для «Коллекционера»», the quests that need it (shot `maps-item`) |
| 03 | Режимы | 12.7–17.1 | PvP → PvE → Сезон: the switch slides, the overview of each mode behind it («у каждого своя база») |
| 04 | Путь к Каппе | 16.7–21.1 | The owner's Collector page: a scan sweep, «8 / 44» marked, the Viibiin cell marked |
| 05 | Позиция | 20.7–25.1 | «Ваша точка на карте»: «Карты» in a raid on Customs, the camera moves in on the player's arrow, rings pulse, «Вы здесь»; the phone with the same point (shots `maps-position`, `phone-live`) |
| 06 | Отряд | 24.7–29.7 | Members, «Квесты по картам» (each member's quests per map, shared quests and who has them; the board zooms into the first maps) |
| 07 | Оружейник | 29.3–34.9 | «Сборка под квест «Оружейник»»: the Gunsmith page (every part, the M4A1 build), the Overview's block opened at the M4A1 (stats, mandatory mods with pictures and prices), then the parts row with «Продают: Миротворец — уровень 3» (shots `gunsmith-page`, `gunsmith-panel`, `gunsmith-hover`) |
| 08 | Боссы | 34.5–41.1 | Quick cuts through Решала, Килла, Глухарь, Кабан, then Тагилла turning a full 360° (120 frames played at 30 fps, rigid: no cloth physics) while a pointer hovers the health card: head, thorax, left leg light up |
| 09 | Патроны и барахолка | 40.7–45.9 | Penetration/damage chart of all rounds, «Против брони · BP» (chance per armor class), the GPU's flea prices for the mode |
| 10 | Обновления | 45.5–48.7 | The auto-update window («всегда свежая версия») |
| 11 | Темы | 48.3–52.7 | «Смена темы — в один клик»: the pointer clicks the top-bar palette button five times, the overview cycles Олива → Чёрный мультикам → Металл → Тельняшка → Снаряжение → Олива (shots `theme-<id>.png`, capture group `themes`) |
| 12 | Телефон | 52.3–56.1 | iOS and Android «скоро», sign-in by QR |
| 13 | Синхронизация | 55.7–60.1 | PC, website, phone: one base, the position on the phone |
| 14 | Честная игра | 59.7–64.3 | Raid OS does not inject into EFT, read its memory, automate actions or bypass protection |
| 15 | Финал | 63.9–68 | Raid OS, «Скачать для Windows», raidos.app |

The honesty rules from `CLAUDE.md` apply to the captions: no claim of live inventory, the app does not touch the game,
the phone apps are «скоро», and nothing is shown or claimed over the game (the app draws nothing there since 15.10.2026).
The captions do not explain how the app gets its data (the owner's request, 04.10.2026).
`owner/` holds the owner's screenshots (overview, stash, Collector page; chat 10.10.2026), used as they are.
**Map imagery:** every map in the video (scenes 02, 05, the phone) is a neutral 10 m survey grid drawn by capture.mjs
(`MAP_GRID`), not a map image: tarkov.dev's maps are CC BY-NC-SA (non-commercial), so they are not used in an advert.
The markers on it (quests, exits, transits, the boss, hazards) are the app's own, at their real positions.
Scenes 02, 05 and 07 use the **live catalog** (groups `mapitem`, `mapposition`, `gunsmith`): tarkov.dev's data and item
pictures, fetched with curl through the proxy and cached in `.cache/` (git-ignored), the profile a made-up PvP level 28
with real task ids. The Golden egg's prices (flea 34 333 ₽, Терапевт 34 680 ₽) and the Gunsmith part prices are those
of 16.10.2026. The Gunsmith build picture is the one the app shows for the part. The flea shot hides the sandbox's «демо-данные» notes (there is no
live price source here) and the empty price history.

Prices on screen: GPU — flea PvP 344 000 ₽ / PvE 739 000 ₽ (Tarkov Forge 7-day average to 30.09.2026), Терапевт
124 740 ₽ (scene 09).
Squad members, nicknames and the QR link are made up for the picture. The ammo on the ballistics shot is the
repository's tarkov.dev fixture (16 real rounds).

## Advert (31 s) with music

`trailer.html?cut=ad` plays a 31 s cut for social networks: logo, quests sync, the item card on «Карты», bosses (three quick
cuts, a full turn of Tagilla in 2 s, the pointer on the health card), «Общие квесты на картах», the player's point on «Карты», «Смена
темы» (five clicks on the palette button), PC · site · phone, fair play, the end card. Captions are numbered in the advert's own order (both cuts number them by play order); a Raid OS badge sits in the
bottom-right corner while the features play. Scene changes fall on beats of the music.

```bash
node scripts/trailer/render.mjs --cut=ad           # → scripts/trailer/out/raidos-ad-silent.mp4 (1080p, the version the owner posts)
node scripts/trailer/render.mjs --cut=ad --music   #   … plus raidos-ad-music.mp4 with the generated music
node scripts/trailer/render.mjs --cut=ad --stills  # → out/stills-ad/01-logo.jpg … 10-download.jpg: one photo per scene (02 item-on-map, 05 position)
```

The stills are the moments `still()` marks in the advert's timeline (everything of the scene on screen, before the next
scene fades in), 1920x1080 JPEG without the progress line.

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

Stop both vite servers afterwards.

**The site's two trailers (27.10.2026).** The home page plays `website/public/media/trailer.mp4` in Russian and
`trailer-en.mp4` in English (`website/src/components/Trailer.tsx` follows the site language). Both come from
`trailer-ru.html` and `trailer-en.html` — the same scenes word for word, the Customs map from the owner's own SPT render
(`ownMap.mjs`, `TRAILER_OWN_MAP_ON=1`), the phone's point simulated at the PC's game position:

```bash
TRAILER_OWN_MAP_ON=1 node scripts/trailer/capture.mjs app modes themes squad bossstill boss3d bosshp bossinfo ballistics flea mapitem mapposition gunsmith update phone live kappa site qr
TRAILER_OWN_MAP_ON=1 TRAILER_LOCALE=en BOSSES=Tagilla BOSS_STILLS=Reshala,Killa,Glukhar,Kaban node scripts/trailer/capture.mjs …the same groups
node scripts/trailer/render.mjs --page=trailer-ru.html --out=/tmp/ru   # → trailer.mp4 + trailer-poster.jpg
node scripts/trailer/render.mjs --page=trailer-en.html --out=/tmp/en   # → rename to trailer-en.mp4 / trailer-poster-en.jpg
```

On Windows set `TRAILER_CHROMIUM` (Playwright's chrome.exe) and `TRAILER_FFMPEG=ffmpeg`. render.mjs opens a fresh page
every 8 s of video and waits for the painted frame: in one long run the Windows compositor fell behind the seeks and the
scenes after the themes jumped back and forth.

**The website's presentation** («Двенадцать причин…», `website/src/components/promo/`) uses the same shots, one set per
site language: `TRAILER_LOCALE=en node scripts/trailer/capture.mjs app modes themes squad bosshp ballistics flea
mapitem mapposition gunsmith update phone live` writes the English interface into `shots-en/` (the demo data's quests,
traders and items get their English names there); both sets are converted to `website/src/assets/promo/*.webp` and
`*-en.webp` by `node scripts/trailer/site-images.cjs [en] [names…]` (1200 px wide for screens, the Tagilla 3D frame
composed with the health card for the bosses; `map-item`, `map-position`, `gunsmith-parts` are crops of the «Карты» and
«Оружейник» shots, `phone-live` starts below the live page's top bar).

 `capture.mjs scenegroup ...` re-captures only some groups (`app stash item modes squad
themes bossstill boss3d bosshp ballistics flea minimap mapitem mapposition gunsmith update phone live site qr`; `stash`,
`item` and `minimap` are the old over-the-game shots, no longer used); `boss3d` alone takes about 10 min
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
- Overlays (`#/overlay/item`, `#/overlay/minimap`; old groups, not in the video any more) use a fake
  `window.tarkovDesktop` bridge, a transparent page and a device scale of 4.
- `mapitem` / `mapposition`: a fake raid on Customs through the desktop bridge (`getRaidState`, `experimental.onPosition`
  / `onItem`); the item card is built like the app builds it (`describeItem` → the bridge's item callback →
  `setRecognisedItem`). `TRAILER_ITEM` picks the item (default the Golden egg
  `62a09cfe4f842e1bd12da3e4`), `TRAILER_RANK=1` lists the items with the most open quest needs, `MAP_ZOOM` / `MAP_VIEW`
  set the zoom and the drag. The owner's server switch `minimap` is on in the capture (`raidos.remoteFeatures.v1`).
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
