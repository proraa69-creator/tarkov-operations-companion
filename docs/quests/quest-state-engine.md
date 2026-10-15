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
| `table`  | Tasks-table readings (PvE only)                                      | `applyQuestScanForMode` |
| `story`  | story-pane readings (all modes) and other PCs' chapters              | `applyStoryScanForMode`, `applyRemoteStoryForMode` |
| `legacy` | `manual` records of versions before 0.5 (nothing creates them now)   | migration only |

Plus the mode's floor: the later of `modeResetAt` («Престиж +», «Вайп», a nickname change), `logResetAt` (the game's
trusted reset) and `logEpochAt` (another character). A profile saved by 0.6.0.41 or older has no `questInputs`: they are
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
4. **Tasks table, PvE only**, fills gaps: it decides only where no log, server or manual record exists. It never
   contradicts a log event (a disagreement is a `screen-vs-log` conflict) and never decides «completed»: a table record
   saying completed is a chain guess of older versions and becomes a hint. In PvP and Season the table is ignored.
5. **Story chapters**: the story pane in every mode, plus the logs where they mention a chapter; the newer of the two
   decides, and the chapter's stage and objectives always come from the pane. No manual marks for chapters.
6. **Legacy manual** records fill what nothing else covers (lowest confidence).
7. **Prerequisite inference never decides.** It only gives «вероятно выполнено» hints (`calculateAvailability`'s
   `basis`), shown in lists, never counted.

Confidence: manual 1, log 0.95, server 0.9, story 0.8, table 0.7, legacy 0.4.

Conflicts per quest: `screen-vs-log`, `manual-overridden`, `before-floor` (an observation older than the floor),
`table-outside-pve`, and with the catalog `prerequisite-open` (completed while a mandatory prerequisite is active or
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
Now only resolved completions count; the inferred ones stay visible as «вероятно выполнено».
