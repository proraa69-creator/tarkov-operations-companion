# Quest-state engine

Owner, 15.10.2026: «разработай систему, которая не будет путаться в квестах, все должно взаимодействовать как одно
целое и сравнивать данные, а не работать по отдельности.»

Code: `src/quests/questEngine.ts` (pure, no React, also imported by the server), `src/quests/questInputs.ts` (the
per-source store and its writers), `src/quests/questReadModel.ts` (the memoised read side), tests in `src/quests/*.test.ts`.

## Why

Until 0.6.0.41 every source wrote straight into one record per quest (`ModeProgress.taskProgress`) and each writer had
its own rule: the log applier, the Tasks-table applier (which also stored chain completions as «completed»), the story
applier, the server merge, legacy `manual` records, and every page ran its own prerequisite inference on top. Nobody
could tell afterwards which source said what, and counts took inferred quests as done: PvE showed 226 completed while
the game had 154 (the owner's logs give 1 handed-in quest and 223 inferred ones, see «The 226/154 count» below).

## Inputs, kept apart

Per mode, `ModeProgress.questInputs` keeps what each source said, never merged:

| Layer    | What                                                                 | Written by |
|----------|----------------------------------------------------------------------|------------|
| `log`    | newest event per quest of this PC's game logs                        | `applyLogScanForMode` |
| `server` | the server's records of the mode's character (all PCs' log events)   | `applyLogStateForMode` (push answer, phone/second-PC pull) |
| `manual` | «Ручная отметка» marks: `active`, `completed` or `cleared`, with time | `setManualQuestMark`, server sync |
| `table`  | Tasks-table readings (every mode since 0.6.0.170)                    | `applyQuestScanForMode` |
| `story`  | story-pane readings (all modes) and other PCs' chapters              | `applyStoryScanForMode`, `applyRemoteStoryForMode` |
| `legacy` | `manual` records of versions before 0.5 (nothing creates them now)   | migration only |

Plus the mode's floor: `logResetAt`, the game's own last reset as the logs prove it (a catalog trader quest taken again
after its hand-in, or the backend's «/client/prestige/obtain» / «/client/game/profile/create» request) or a press of
«Престиж +» / «Вайп» (below), and a new character (profile id) of the mode. A profile saved by 0.6.0.41 or older has no `questInputs`: they are
built once from its records by source (`inputsFromRecords`), then the profile is saved in the new shape. `taskProgress`
stays in the stored profile, always equal to the engine's output, so older readers keep working.

## One decision: `resolveQuestStates(inputs, catalog?)`

Pure, per mode. For every quest id any layer names it returns a `ResolvedQuest`: `status` (`not-started | active |
completed | failed`), `source` (the layer that decided), `at`, `confidence` and `conflicts`. Precedence, enforced only
here:

1. **Floor.** Any observation older than the floor is ignored (counted in the diagnostics).
2. **Game logs** decide trader quests. `log` and `server` are one stream: the newest event wins; on a tie this PC's log.
   The decision keeps its origin (`log` or `server`) and time.
3. **Manual mark** wins over an older log event and loses to a newer one (then listed as `manual-overridden`).
4. **Tasks table, every mode** (owner, 31.10 and 01.11.2026: PvP and Season too; since 04.11.2026 only until the mode's
   first sync ended, below; «Найти квесты по экрану» on the Quests page reads it on demand), fills gaps: it decides only where no log, server or manual record exists. It never
   contradicts a log event (a disagreement is a `screen-vs-log` conflict) and never decides «completed»: a table record
   saying completed is a chain guess of older versions and becomes a hint. A quest the logs already decided is not even
   written to the layer (AppState `applyQuestScanForMode`).
5. **Story chapters**: the story pane in every mode, plus the logs where they mention a chapter; the newer of the two
   decides, and the chapter's stage and objectives always come from the pane. No manual marks for chapters.
6. **Legacy manual** records fill what nothing else covers (lowest confidence).
7. **Inference never decides a status; only a proof counts.** A mandatory, completion-only prerequisite of a quest the
   game reports as held or handed in is proven completed (`calculateAvailability`'s `proof: 'prerequisite'`): the game
   lets no one take a quest before it, and the logs reach back only a few weeks, so without it an older player would
   count almost nothing. It counts in «Выполнено». The chronology's guesses (`basis` `line` / `stage` / `start` and its
   own chains) stay «вероятно выполнено» hints in the lists, never counted.

Confidence: manual 1, log 0.95, server 0.9, story 0.8, table 0.7, legacy 0.4.

Conflicts per quest: `screen-vs-log`, `manual-overridden`, `before-floor` (an observation older than the floor),
`table-completed-unproven`, and with the catalog `prerequisite-open` (completed while a mandatory prerequisite is active or
failed) and `unknown-quest` (not in the mode's catalog).

## Everything reads from it

- Writers change only their layer and call `commitQuestInputs`, which runs the engine and stores its output as
  `taskProgress`. No writer merges sources itself: `applyLogQuestState`'s source rules, `mergeTaskRecords`,
  `applyTaskRecordsForMode`, the Tasks table's chain completions and the legacy-manual precedence are gone.
- Readers: `questAvailabilityOf(quests, progress)` and `questResolutionOf(progress, mode, quests)` (memoised per input set and catalog) for lists, tabs, «Выполнено», Kappa, «Прогресс», the
  trader boards, the Overview and the map quest sheet; counts take only resolved `completed` (`provenCompleted`).
- Server: friends', squad mates' and the cabinet's counts merge the log records and the manual marks with the same
  engine (`server/src/services/sharedProgress.ts`). Sync pushes send inputs with their source (log events, manual marks,
  chapters), never the merged state.

## The reset buttons

«Престиж +», «Вайп» and «Сброс» (Profile → «Текущий профиль») each wipe the mode's records in the app and on the server and
read the mode again from the logs (the latest scan, through the engine); the server then gets the events again.

- **«Престиж +», «Вайп»** (owner, 04.11.2026: «квестов у человека не будет, и он все проходит заново. То есть ему не нужны
  старые логи»): the press is the floor, nothing older counts, on this device, on the server and on the account's other
  devices (`floorAfterReset`, `logResetAt`; `POST /v1/me/progress/:mode/reset { floor }`). A quest shows again when it is
  taken in the game after the press, or read on the Tasks screen (a press opens the mode's first sync again). If the logs proved the game's own reset up to 7 days
  before the press, that reset is the floor instead: the quests since are the new profile's, and a press only to choose
  the prestige must not hide them. This replaces the decision of 15.10.2026 for these two buttons.
- **«Сброс»**: every log counts, the quests are found again. A floor an earlier press set (`appResetTimes`) goes, so it
  undoes a press by mistake; the game's own proven reset stays.
- **A new nickname** comes by itself: no floor, a pending marker `resetMarker {kind, at}`; when the logs show the game's own
  reset after it, that point becomes the floor and the marker resolves. Markers of «Престиж +» / «Вайп» from older versions
  work the same until then.

Profiles of 0.6.0.40/41 with a floor at a press (`modeResetAt`) get a pending marker at load and the floors the press wrote
go; a 0.6.0.41 server answering the press as the character's reset is ignored (`appResetTimes`).

A press also clears what the player gathered (owner, 04.11.2026: «должно сбрасываться все, что в избранном все квесты
актуальные итд»): the mode's tracked quests, raid list and «Отложенные квесты», the items found for the hideout and the
quests, the last stash scan, and «Избранное», one list for every mode, so for all of them. A new nickname keeps the lists.

## «Ручная отметка»

Source `manual-fix`, not the legacy `manual`: the legacy records come from versions before 0.5, whose marks were retired
(P19) because they silently beat the logs; reusing the name would revive them with the new precedence. They stay in their
own `legacy` layer (lowest). Marks are kept per account and mode on the server (`/v1/me/progress/:mode/manual`, newest per
quest, `cleared` for «Снять отметку»), removed by the mode's reset and never offered for story chapters.

## The chain: what opens a quest

`calculateAvailability` (src/progression/requirementEngine.ts) over the engine's decisions, per mode. An explicit status
(the engine's) always wins; otherwise, in this order:

1. **Prerequisites**: every quest the game reports as held or handed in (logs, other PCs, a mark, the Tasks table, the
   story pane) proves its mandatory, completion-only prerequisites completed, recursively (counted). «Оружейник» parts
   come from the logs only, and from the player's own marks: each part on «Оружейник» has a checkmark, and its card
   «В текущие» / «Выполнено» / «Снять отметку» — the same «Ручная отметка» (a player's ticket, 02.11.2026: the parts
   done before the oldest log show nothing otherwise).
2. **Character level**: the higher of the profile's level and the level of any quest the player holds or handed in.
3. **Faction**: only an explicit USEC/BEAR quest is closed to the other faction; an unknown faction closes nothing.
4. **Trader lines** (tarkov.dev `otherRequirements`): a line is open once a quest of that line's level was taken; with a
   history from before the logs, a line the logs say nothing about is «may be open» (`unknown`), never closed.
5. **Trader loyalty**: what the tasks prove (a held quest that needs loyalty N), and what the game's traders' screen showed
   for this character (src/gunsmith/traderLevels.ts `screenLoyaltyByTraderId`, owner 02.11.2026). The screen only lifts a
   doubt: a quest that waits only for loyalty the screen shows reached is open, not «may be open»; a lower reading closes
   nothing (an old or misread badge must not hide a quest the player can take).
6. **The game's own conditions** (a talk with the trader, hidden counters, bad standing): closed until the game reports it.

## When a quest leaves the lists

A quest seen held never disappears by itself. It goes only when:

- the game closes it: a hand-in or a failure in the logs (or another PC's, through the server), newer than any mark;
- a «Ручная отметка» says so (newer than the game's last event), or «Снять отметку» removes a mark;
- a whole read of the Tasks table does not list it (below);
- the game's reset (prestige, a new profile, a trader quest taken again) or a new character of the mode sets the floor
  or the epoch; a mark the server keeps from before the new character does not come back (owner, 02.11.2026);
- the chain rules it out (below): a Tasks-table reading the logs contradict goes, and a quest they hold open past a later
  quest of its chain counts as handed in.

«Отменить» in a quest's history writes the previous status back as a «Ручная отметка» (owner, 02.11.2026: it used to
write `taskProgress` directly, and the engine's next run undid the undo); only «в текущих» and «выполнено» can go back.

## The chain against the records

A player's ticket №37, 04.11.2026: «Каратель. Часть 3», «Серьёзные обвинения» and «Документы» in the app, not in the game.
The owner: «если у человека есть каратель часть 1, у него не должно быть части 3… это могут быть разные квесты, но если они
идут по цепочке». Everything below was measured that day on all players' records (read only).

**What the catalog is worth.** A later quest in the logs against a mandatory earlier one: 3287 in order, 99 with its hand-in
missing, 17 with the earlier handed in within 30 days after the later was taken, 13 of those two pairs (`NOT_IN_THE_GAME`). So
the chain holds; the guess that it is an old scheme does not. What is true of «one quest gives three»: 168 quests open by a
trader's line (`unlock.lines`, `gameConditions: ['progress']`), not by a prerequisite, and players take them in bursts.

**The reader** (`src/import/questOcr.ts`). The Tasks screen shows the open quest's text on the same frame as the table, and
its lines read as titles: 71 titles of the catalog came out of its own texts by a word that starts a title («серьёзные» is
«Серьёзные обвинения») or a title inside a sentence («документы»). That is the main source of false records. Now only a row
of the table (`isTableRow`: a title, then its columns) may name a quest loosely; 13 titles are left, from a line wrapped exactly
at the word. A row names the part its number says, in every pass; `|`, `l`, `I` after the word are a 1; no number read, or one
no part has, names none while the chain has several. The first part the catalog names without a number («Инвентаризация»,
«Простая задача») is also its «… Часть 1». A frame with «заблокировано» / «доступно» rows counts only rows whose status was read
(a trader's tab with «Показать заблокированные», `tableMatches`).

**The records** (`src/quests/questChain.ts`, `withQuestChain`). The engine has no catalog at a write, so this works on its
layers with one: AppShell runs it whenever the mode's records change, with that mode's catalog; a new frame's rows are held to
it at once. `taskProgress` stays the engine's output, so «Текущие», the map, the overview, the raid card and the item overlay
all follow, the corrected copy goes to the server, and the phone and other PCs lose the record with it.

- A quest the screen alone knows goes when a mandatory earlier quest, however far back, has a log record `active`, or
  `completed` more than five minutes after the reading (a record keeps the time of its first reading).
- A quest the logs hold open counts as handed in when they show a later quest of its chain taken after it: 330 of 29839 such
  quests, 149 players. It goes in as a `server` event a moment after it was taken, so any newer event or a mark decides over it.
  Not the Arena's line («[PVP ZONE]», «[PVE ZONE]»): the logs show almost no hand-ins of it at all, so nothing says the game needs
  those quests closed rather than only taken.
- 18 titles the old reader invented far beyond their share in the logs (`MISREAD_BEFORE_THE_MENDING`, screen against logs,
  against a median of 4%): their records from before this PC began the mode's first sync (`tableSync.startedAt`) go, however
  late the PC updated, and that sync brings a real one back. A device with no reader has no such time: the PC's copy decides.

A mark of the player's own stands, on the quest and on the one before it; «История изменений» shows each change with «Отменить».

**Set apart, by the logs' own record.** `LOGS_MISS_THE_HAND_IN`: open with a later quest logged 15% of the time or more, «На
свет» (78 / 1), «Путь выживальщика», the [PVP ZONE] line: their being open rules out nothing (86 / 6629 for the rest, 1.3%).
`LOGS_NEVER_NAME`: 11 quests held by the screen and named by no log («Шиномонтажка», «Источник информации»). «Оружейник»: its catalog
chain does not hold (`gunsmithFromLogs`). The lists are from one day's data: a new chain like «На свет» would need adding.

**The risk left.** A real quest stays hidden if the logs missed the hand-in before it (1.3%) and its own «taken» as well; a mark
or the logs' next event brings it back. A quest counted as handed in is wrong if the catalog's link does not hold (0.1% beyond
the two pairs); «Отменить» brings it back. A real record of the 18 titles is gone until the mode's first sync reads its row, and
if the sync ends without its page having been read, until a mark, the logs' next event or «Найти квесты по экрану». Records of
other titles from the old reader stay: nothing tells them from real ones.

## The first sync of the Tasks table

Owner, 04.11.2026: «оставить только при первом запуске, что бы прошла синхронизация, больше сканировать не надо так как логи
новых и закрытых квестов будут появляться». Code: `src/import/tableSync.ts`, `src/components/StoryScreenScanner.tsx`.

- **One for each mode of each profile on each PC** (`ModeProgress.tableSync`, sent nowhere). PvP, PvE and the season each have
  their own; a new PC has its own, the account's copy filling its gaps meanwhile.
- **It stays open until the table was really read**, however long that takes: nothing but readings ends it. A visit (the table on
  screen, until it is not) counts with two fresh readings that named a quest. It ends when the whole list was read twice alike
  (it fits on a page); or from the second visit on, when a visit adds no quest and the readings so far name 75% of the trader
  quests the logs hold open, which says the list was scrolled and not only its first page read (players hold 39 current quests
  on average, about nine rows a page); or after 6 visits whatever they showed, since logs may hold quests the game no longer lists.
- **What empties a mode opens it again**, that mode only: «Сброс», «Вайп / Престиж» and a new nickname (`wipeModeProgress` builds
  the mode without it), a new character or the game's own reset in the logs (`applyLogState`).
- **Every player already here gets one**, as a profile of an older version has none. It is the one exception to the owner's
  word, made on purpose: only that read with the mended reader brings back a real quest of the 18 titles above. It costs nothing
  to anyone who does not open «Задания», and ends like any other.
- **After it** the table is passed over at the slow pace of a screen with nothing to read. Still read: the story pane (the game
  never logs chapters), «Выбор профиля и режима», the traders' screen. Still there, each for a while and on purpose:
  «Найти квесты по экрану» and the owner's grant.
- **What it costs.** A quest no log names (`LOGS_NEVER_NAME`, 11) is not found if taken after the sync, and stays current after its
  hand-in, until «Найти квесты по экрану». A hand-in the logs missed is closed by the next quest of the chain, or by that read. A page
  of the list not read during the sync is not read later by itself.

## A whole read of the Tasks table

Owner, 04.11.2026: «Лишний квест нужно переделать. Не должно быть, чтобы человек сам его должен был убирать … Если его нету в
квестах по экрану, он делает сканирование также, и этот квест уходит, если его нету. Обнаружение должно быть четкое. Смотри
название квестов, и должно быть стопроцентное совпадание». Code: `src/import/tasksTableLayout.ts` (the picture),
`src/import/tableSweep.ts` (the proof), `electron/screenOcr.ts` `readTasksTable`. It takes part in the first sync and in
«Найти квесты по экрану»; the read ends the search.

**Reading.** On a table frame the title and status columns and the «Поиск» field are read once more, each a picture of its own at
the frame's size, about half a second. Measured on real frames, against the live catalog: the whole-screen pass named 3 of 9
titles exactly, the title column 9 of 9 on the same frame and every one of 5 on a sharper one. A bigger scale reads worse
(«Часть 10» as «Часть 18»). The rows, the scrollbar and the open tab come from the picture, not from OCR, so a row OCR lost
is still a row, unread.

**What names a quest.** A row's title read exactly as the game's language writes a catalog quest's title (`ocrKey` equal: case,
punctuation and look-alike letters aside). No part of a title, no «close enough»; the loose readings of `matchQuestsFromOcr`
no longer fill the table's layer at all. A numbered title not held yet must read alike at two positions of the list: one digit is
another part, the only way an exact title can be wrong.

**What proves the whole list.** All of these, or nothing goes:

- the frames join by their rows into one list, from a frame with the thumb at the top of its track to one with it at the
  bottom; or one page with blank space under its last row;
- every row is settled: exact, or a title the catalog lacks (it lags behind the game: «Честный отзыв», «Сечь поляну» on a real
  frame), which must read alike at two positions and be near no catalog title, and then names nothing;
- as many rows as the thumb's length says, within one row and 6%;
- «Побочные» is open, «Поиск» shows its placeholder, and the game's corner stamp names no other mode than its logs. A frame
  that fails one of these counts for nothing, and the page tells the player why in a line.

**What «left» means to the engine.** Not current, and nothing else: the table cannot tell a hand-in from a failure or a misread
record. A quest it does not list gets the mark `absent` at the read's first frame, in that mode:

- every «held» from before it goes, from any layer; a newer event of the game, or a newer mark, decides as ever. So the logs read
  again do not bring it back, and taking it again does. A hand-in or failure from before it stands: only «active» goes.
- it is not counted in «Выполнено» and proves nothing. A quest only the screen ever knew leaves nothing behind: the quests before
  it are no longer proven by it. A quest the logs reported taken was really taken: what it needs stays proven, and it shows as
  «вероятно выполнено», uncounted (`basis: 'left'`), so the next quest of its chain can open.
- it travels with the marks (`POST /v1/me/progress/:mode/manual`): per mode, the newest per quest, gone with a reset, to the
  other PCs and the phone. Apps older than this ignore the mark.
- a row of the read over an older hand-in or mark decides (`proven`): the list is the newer word. A hand-in after the first frame
  decides over the row: the read's time is its first frame's, so what happens during it is the logs' to tell.

Story chapters and their quests are never touched (another tab), nor ids the catalog does not know.

## Chain checks («Проверки цепочки»)

src/quests/questChecks.ts restates the rules above on their own, without calling the engine, and checks a mode's inputs,
the engine's decision, the stored statuses and the lists' availability (owner, 02.11.2026: «построй логическую систему
проверок … не допусти регресса»):

| Rule | Holds when |
|---|---|
| `floor` | nothing older than the floor decided a quest |
| `game-closes` | the game's newest hand-in / failure decided the quest, unless a newer mark or a newer story reading |
| `game-over-screen` | where the game reported a quest, the Tasks table or a legacy record did not decide it |
| `seen-stays` | a quest seen held after the floor (logs, screen, mark, story) is not «not started» |
| `screen-never-completes` | the Tasks table did not decide «completed» |
| `screen-chain` | no quest stands from the screen alone while the logs say a quest it needs was open at that reading |
| `later-closes` | no quest stays open in the logs past a later quest of its chain they show taken |
| `mark-order` | a mark at or after the game's event decided; a newer game event beat the mark |
| `stored-is-decided` | the stored statuses equal the decision (no writer bypassed the engine) |
| `chain` | the mandatory prerequisites of held / handed-in quests count as completed |
| `level` / `faction` | no quest offered as open needs a higher level or the other faction |

The tests run them over every scenario, 500 seeded random mixes of every layer and floor, and the owner's real logs
(src/quests/questChecks.test.ts): a change that breaks a rule fails there before a release. The owner's «Диагностика
квестов» shows them for the live state of each mode («Проверки цепочки: все 12 правил выполняются», or which and where).

## Diagnostics

`withInferred(resolution.diagnostics, availability)` per mode: how many quests each source decided (completed / active / failed),
what the Tasks table added, the chain hints (not counted), the conflicts by kind, the observations below the floor and the
ids not in the catalog. One line explains a count at a glance: «логи: 154 выполнено, экран: +0, вывод из цепочек: 0 (не
считается)». Shown in the owner's app only, «Диагностика квестов» in Settings.

## Performance

The engine runs on a write (one mode, a few hundred ids) and the hooks memoise on the input objects and the catalog
(src/quests/questReadModel.ts: WeakMap caches shared by every component), so a re-render does no work and the scanner's unchanged frames change no
object.

## The 226/154 count

`completedQuestStats` (src/progression/requirementEngine.ts) counted every quest whose availability was «completed», and
`calculateAvailability` marks as completed the mandatory prerequisite chain of every held quest and the chronology of
the trader lines. Fixture `src/progression/__fixtures__/owner-logs-2026-09.json`: 1 handed-in PvE quest, 223 inferred.
Now resolved completions and the prerequisites they prove count (the fixture: 1 + 6); the chronology's guesses (~200) stay
visible as «вероятно выполнено». Prerequisites are not where 226 came from: the chronology was.
