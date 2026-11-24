# «Хеллоуин 2026»: where the event's data comes from

Owner, 02.11.2026: «найди все данные по Хеллоуинским квестам, которые идут в данный момент, и добавь их так же как у нас был
ивент, сделай кнопку Хеллоуин… к квестам добавь метки на карте, описание и фото расположения (без фото карт)»; then
«ставь точки на обычных картах» and «не добавляй надписи что взять с тарков дев».

The event came with game version 1.3.0.0.48484 on 29.10.2026: the infected Factory and Lab, Skier's and Therapist's task
lines, two choices. tarkov.dev lists the infected maps in all three modes' maps files and the event's three achievements,
but none of its tasks (02.11.2026), so the app carries them as a curated series (`src/data/curatedQuests.ts`
`HALLOWEEN_2026`), shown in the window of the Overview's «Хеллоуин» button (`src/events/HalloweenEventWindow.tsx`).

## Quests

- **Ids**: the Russian EFT Wiki's quest pages (`escapefromtarkov.fandom.com/ru/wiki/Halloween:_…`, infobox `node`). Two
  choice quests have two ids, one per branch: «Усиление карантина» `6abb92e1505493a036006ee0` | `6abb86cddcebb0efbc0fda8f`,
  «Новая вакцина» `6abd0ff5d383d797d602d6c4` | `6abd18fed383d797d602d6c9`. Which id is which branch is not published, so
  the app keeps one quest under the first id and counts the other id's log lines for it (`otherIds`,
  `src/quests/questInputs.ts`); the branches' own objectives and rewards are in the notes.
- **Order**: the wiki pages' «previous» / «leads to», checked against tarkov.help's quest graph. The choices: a quest of
  the other side fails, so the next quest asks for its precondition «complete or failed» (`afterDecided`).
- **Objectives**: the game's words, as tarkov.help (ru, en) and the English wiki print them.
- **Rewards**: the English wiki's base amounts (without the Intelligence Center bonus; tarkov.help shows them with it).
  «High-Risk, High-Reward»: 44 000 experience as tarkov.help gives it (the wiki's 41 000 and 300 000 ₽ repeat «A New
  Vaccine»'s), the items as the wiki lists them.
- **End**: not announced by the game (02.11.2026); the last Halloween ended on 11 November. The app shows the event
  until `HALLOWEEN_2026_END` (12.11.2026, 10:00 Moscow) and is to be moved once the end is known.

## Map points

The infected maps are the ordinary Factory and Lab (`src/data/mapIds.ts`: `infected-factory` → `factory`,
`infected-lab` → `the-lab`), so their points are drawn there.

- **Customs, Woods, Factory**: tarkov.help's public quest markers (`/api/ru/map/<map>/filter/quest/<id>`; markers
  16026–16030 «Ослепить противника», 16040–16042 «Контрольная проверка»), carried over to game coordinates by an affine
  fit of the exits both maps have (tarkov.help's exit polygons' centres against json.tarkov.dev regular/maps extracts and
  transits). Misfit of the exits: Customs ≈ 1–7 m (one outlier dropped), Woods ≈ 0.4–14 m near the cameras (the depot and
  the railway bridge 0.4 and 3.8 m), Factory 0.7–4.1 m on the ground floor's exits only (tarkov.help draws the offices and
  the cellars beside the ground floor). The points have no height.
- **Lighthouse, Reserve, Shoreline, Lab**: tarkov.help's maps of these need an account, so the points are tarkov.dev's
  own places in the building the walkthroughs name: water treatment building no. 2 (the storage room door,
  `62987e26a77ec735f90a2995`) and no. 3 (the Rogue USEC barrack door, `62a9cb937377a65d7b070cef`) — the buildings read off
  the wiki's marked Lighthouse map by its padlocks, which match tarkov.dev's doors at one scale; Reserve's train depot (the
  zone of «Тропа охотника. Управляющий»); the Health Resort's west wing third floor (room 301) and east wing end (room
  328); the Lab's tunnel to «Накопительный коллектор» (the exit) and the blue keycard room (its door).

## Photos of the places

`src/data/eventGuidePhotos.json`: tarkov.help's walkthrough screenshots (29 pictures, 30 places) tied to the objective
each shows; its quest banners and every map picture left out by eye. The server keeps them like the wiki's
(`server/src/services/guideImages.ts`), from tarkov.help's picture host only. No source line in the app (owner's word).
