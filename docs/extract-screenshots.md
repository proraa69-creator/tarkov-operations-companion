# Extract screenshots

Hovering an extract on the map shows a screenshot of the exit when a file exists for it.

- Folder: `public/extract-shots/<mapId>/<extractId>.jpg` (16:9 recommended, ~640×360, under 80 KB).
- `<mapId>` is the app's map id (`customs`, `woods`, `shoreline`, `interchange`, `reserve`, `lighthouse`, `streets-of-tarkov`, `factory`, `ground-zero`, `the-lab`, `icebreaker`).
- `<extractId>` is the tarkov.dev extract id, which is `marker.extractId` on the extract marker (the marker id is `extract-<extractId>`).
- A missing file is simply not shown; nothing else changes.

No screenshots are bundled yet: they have to be captured in game (or sourced with permission from a community
project) and dropped into the folder. Only screenshots that are ours or licensed for redistribution should be committed.
