# «KORD BREACH»: the Season 1 story line

Owner, 19.11.2026, with two in-game screenshots («Незваные гости. Часть 1», «Звонки без ответа»): «этого квеста нету у нас в
базе, добавь его и проверь какие перед ним квесты и после него, собери цепочку».

tarkov.dev has none of these quests in any mode (`regular`, `pve`, `pvp-season` tasks of 19.11.2026). The app adds them
for Season only: `src/data/kordBreachQuests.ts`, series `KORD_BREACH` in `CURATED_SERIES`.

## The chain

| # | Quest | Trader | Opens after | Game id |
|---|---|---|---|---|
| 1 | Незваные гости. Часть 1 / Uninvited Guests - Part 1 | Prapor | Season character (after the «Тур» chapter) | `6a4f528221e50974ab006f6f` (log) |
| 2 | Незваные гости. Часть 2 / Part 2 | BTR Driver | Part 1 taken | `6a4f53f6be2cd3a87c0b708d` (log) |
| 3 | Звонки без ответа / Unanswered Calls | Therapist | Part 1 taken | `6a4f83001b7350af050b2e1f` (log) |
| 4 | Забросить невод / Cast the Net | Prapor | Part 2 | `6a4f5a3d6bfb56d6de0b2dd8` |
| 5 | Знай своего врага / Know Your Enemy | Prapor | Cast the Net | `6a4f5b7a5bf30a99be02698c` |
| 6 | Задняя передача / Reverse Gear | Prapor | Know Your Enemy, +0–2 h | `6a4f5c207368e70cae00e6ec` (log) |
| 7 | На волне популярности / Riding the Wave | Ragman | Reverse Gear | `6a4f833633bd1e904c091ef2` |
| 8 | Ключ к пониманию / Key to Understanding | Fence | Reverse Gear, level 20 | `6a4f5eed0aba4eefcd0b1cc7` |
| 9 | Что в сумке? / What's in the Bag? | Fence | Key to Understanding, +1–2 h | not known |
| 10 | Запретные знания / Forbidden Knowledge | Fence | What's in the Bag? | `6a4f5fda45f72a73f3089a8a` (log) |
| 11 | Волк в овечьей шкуре / Sheep in Wolf's Clothing | Fence | Forbidden Knowledge | `6a4f602f02d214b87f065c40` (log) |
| 12 | Финишная прямая / Final Stretch | Fence | Sheep in Wolf's Clothing | not known |
| 13 | Последствия наших решений / Consequences of Our Decisions | Mechanic | Final Stretch taken; a choice with 12 | not known |
| 14 | Отчаянный штурм / Desperate Assault | Mechanic | 12 or 13 done | `6a4f789e78d54a8494027cbf` |
| 15 | Капкан / Stay Clear of Blast Zone | Jaeger | Desperate Assault taken | `6a4f8365d46563d5d90b6ccc` |
| 16 | Разрыв цепи / Break the Chain | Mechanic | Desperate Assault | not known |
| 17 | Цифровой пазл / Digital Puzzle | Mechanic | Break the Chain | `6a4f7a63e41198323708563b` (log) |
| 18 | Плата за информацию / Price for Information | Lightkeeper | Digital Puzzle | `680fa1f6fff4a8d640066b42` |
| 19 | Во имя человечества... / In the Name of Humanity... | Lightkeeper | Price for Information | `6a4f82d2c871d92f960543c6` |
| 20 | ...во благо избранных / ...for the Good of the Chosen | Lightkeeper | In the Name of Humanity... | `6a8d4ea68a0ba8e3c5036b95` |
| 21 | Исторические перспективы / Historical Prospects | Lightkeeper | ...for the Good of the Chosen | `6a4f82e11b7350af050b2e1c` (log) |

- **Ids** are the Russian wiki's `node`. «(log)»: the owner's logs of 19.11.2026 name the id too. Season host
  `gw-pvp-season`; Part 1 (Prapor) and Part 2 (BTR Driver) were taken at 12:53:13, Unanswered Calls (Therapist) at 12:58:37.
  The game's «Can't find condition for target … quest id: …» lines name the season rewards' quests. Their order matches the
  wiki's season reward table, so the unknown `6a4f7a63…` (LV-119 V1 reward) is Digital Puzzle.
- **No published id** for 9, 12, 13 and 16. They use `kord-breach-…` ids that never look like a game id, so their log lines
  are not matched. Replace each with the game's id once a log names it.
- `680fa1f6…` (Price for Information) does not follow the `6a4f…` pattern of the line, and no log confirms it yet.

## Where the sources disagree

| Point | Russian wiki | English wiki | tarkov.help | App |
|---|---|---|---|---|
| Part 1 needs Prapor LL2 | yes | — | yes | **no**: the owner took it at Prapor LL1 (screenshot) |
| Part 1 «bring the case to the BTR Driver» | yes | yes | — | **Part 2 only**, as the in-game Tasks screen shows |
| Know Your Enemy, BD gear | 5 | 3 | 3 | 3 |
| Forbidden Knowledge, SSDs | 3 | 2 | 2 | 2 |
| Sheep in Wolf's Clothing, kills | 4 on each of 3 maps | 8 | 8 | 8, any map |
| Desperate Assault, kills on The Lab | 15 | 8 | 8 | 8 |
| Reverse Gear delay | 0–1 h | 0–2 h | — | 0–2 h |
| Trader of 9, 10, 11 | Fence | Fence | Prapor | Fence |
| Trader of 13 | Mechanic | Mechanic | Fence | Mechanic (the laptop goes to Mechanic) |
| Stay Clear of Blast Zone opens after | Desperate Assault taken | the same | Consequences | Desperate Assault taken |
| Unanswered Calls, CMS kits | 2 | 3 | — | 3 (in-game screenshot) |

- Cast the Net's 6 WI-FI cameras at the start: tarkov.help only.
- Achievements: «Деньги не пахнут?» (Profit Over Principles) on 12 and 13. The Russian name of Historical Prospects'
  «Among Strangers» is not known, so it is not shown.
- Season reward unlocks («Сезонная награда» lines) come from the English wiki's Seasonal Rewards table.

## Not done yet

- **Map points:** the transits (18, 19), the two Ground Zero exits (3) and the four WI-FI camera spots (4, 6; found in the
  offline copy of the game by tarkov.help's pictures, 20.11.2026, report 204). The case spots, transmitters, fence breaches and
  stash spots have no point yet: the same search runs for them (E:\SPT-photo\approved\kord-breach\places.json).
- **Quest items** of the line (the case, Therapist's letter, the laptops, the carbon fiber case) have no item ids in
  tarkov.dev. The objectives name them in their text only.

## Sources

- https://escapefromtarkov.fandom.com/ru/wiki/Незваные_гости._Часть_1 and the 20 other pages of the template «Квест Сезон 1 KORD BREACH (плашка)»
- https://escapefromtarkov.fandom.com/wiki/Seasons (the line, the season rewards), https://escapefromtarkov.fandom.com/wiki/KORD_BREACH
- https://tarkov.help/api/ru/quests/<seo_link> of the 20 `*-kord-breach` quests (goals, guides)
- https://tarkovforge.com/task-guide/digital-puzzle
- The owner's game logs of 19.11.2026 (`push-notifications`, `output`, `backend`) and the two in-game screenshots
