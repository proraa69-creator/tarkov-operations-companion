# Extract screenshots

Hovering an extract on the map shows a screenshot of the exit when a file exists for it.

- Folder: `public/extract-shots/<mapId>/<extractId>.jpg` (16:9 recommended, ~640×360, under 80 KB).
- `<mapId>` is the app's map id (`customs`, `woods`, `shoreline`, `interchange`, `reserve`, `lighthouse`, `streets-of-tarkov`, `factory`, `ground-zero`, `the-lab`, `icebreaker`).
- `<extractId>` is the tarkov.dev extract id, which is `marker.extractId` on the extract marker (the marker id is `extract-<extractId>`).
- A missing file is simply not shown; nothing else changes.

No screenshots are bundled here. Since 04.11.2026 the exits' texts, floors and photos come from `src/data/extractGuide.json` (`scripts/extract-guide.mjs`, the texts in `scripts/extract-guide-notes.mjs`): the server keeps a copy of each listed photo and the apps take it from there. A file in this folder is used only for an exit that list does not cover.
