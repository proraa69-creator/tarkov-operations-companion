# «Новое начало» (New Beginning): the prestige quests

Report №100 (08.11.2026): «Для каждого престижа … нужно проходить квест новое начало, не нашел его в списке квестов».
The reporter plays PvE at prestige 3.

## What the sources say

| Quest | Game id | Given at | PvP level | PvE level | tarkov.dev PvP | tarkov.dev PvE |
|---|---|---|---|---|---|---|
| New Beginning (Prestige 1) | `6761f28a022f60bb320f3e95` | prestige 0 | 25 | — (PvE prestige 1 does not need it) | yes | no |
| New Beginning (Prestige 2) | `6761ff17cdc36bd66102e9d0` | prestige 1 | 30 | 20 | yes | no |
| New Beginning (Prestige 3) | `6848100b00afffa81f09e365` | prestige 2 | 35 | 30 | yes | no |
| New Beginning (Prestige 4) | `68481881f43abfdda2058369` | prestige 3 | 40 | 35 | yes | no |
| New Beginning (Prestige 5, 6) | not known | prestige 4, 5 | 47 | 45 | no | no |

- **Ids:** the Russian wiki's `node` for prestige 1–4; the game's own log names the same ids as conditions of the prestige
  levels (`Can't find condition for target 6761ff17… quest id: 672df428…` and so on, the owner's log of 02.11.2026). The
  game's conditions of prestige 5 and 6 name only «Коллекционер»; no «Новое начало» of theirs has an id, so they are not in
  the app.
- **Levels:** English wiki (`New_Beginning_(Prestige_N)`: «Must be level 30 … (20 in the PvE mode)»), tarkov.help's PvE page
  agrees (20, 30, 35).
- **Objectives and rewards:** tarkov.dev's PvP tasks file (the same quests). The wiki lists the third one without the
  Lab → Streets transit; tarkov.dev, read from the game, has it, and the app follows tarkov.dev.

## In the app

- `src/data/curatedQuests.ts` `NEW_BEGINNING_PVE`: prestige 2, 3 and 4 in PvE, with PvE levels and the game's objective ids.
  PvP keeps tarkov.dev's own quests (a curated quest tarkov.dev has under the same id is left to tarkov.dev).
- `src/progression/prestigeQuests.ts`: the prestige each one is given at (also tarkov.dev's `requiredPrestige` for later
  ones). `requirementEngine.ts` opens only the one of the character's prestige: «Нужен престиж N» ahead,
  «Только на престиже N» behind. The chronology never marks them «probably done»; the needs, keys and keep lists skip the
  ones behind the character's prestige.
- The game gives each one at exactly its prestige (one «Новое начало» at a time in the trader's list); that is how the app
  reads `requiredPrestige`. Not confirmed with a PvE log yet.
