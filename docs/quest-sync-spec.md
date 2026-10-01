# Quest synchronization — spec summary and gap analysis

Source: owner's dev-spec «RaidOS EFT Quest Synchronization Specification» (`RaidOS_EFT_All_Quests_Sync_Spec.docx`,
generated 2026-10-01 20:16 UTC). Only the summary is recorded here; the full task catalog in the docx is reference
data that the app already loads live from json.tarkov.dev.

## Spec summary

Coverage of json.tarkov.dev `regular/tasks` at the time of the spec:

| Metric | Value |
| --- | --- |
| Tasks | 515 |
| Objectives | 1441 |
| Objective zones with coordinates | 608 (on 446 objectives) |
| Maps / items in the JSON API | 17 / 5467 |

Not every objective is a point on a map: `kill`/`shoot`, `giveItem`, `skill`, reputation and part of `collect`
objectives are synchronized through quest state, inventory readiness or a manual confirmation.

Objective types by count: giveItem 304, visit 209, shoot 196, findItem 138, plantItem 126, findQuestItem 110,
giveQuestItem 99, extract 86, mark 83, buildWeapon 30, plantQuestItem 13, traderLevel 10, taskStatus 9, useItem 9,
skill 6, sellItem 5, globalVariable 4, experience 2, dialogue 1, traderStanding 1.

### Recommended sync model

1. **Stable task identity.** `taskId` is the immutable primary key. English/Russian names and wiki slugs are
   display/localization fields only.
2. **Objective state.** Track `objectiveId`, objective type, target count, current count, completion source,
   confidence and last observed time.
3. **Map binding.** A separate `quest_map_points` table keyed by `taskId` + `objectiveId`: map id, world position,
   polygon outline, floor/top/bottom and display label.
4. **Automatic sources.** Log import for accepted/completed/failed tasks; screenshot/OCR only as a confirmation
   channel; inventory recognition for giveItem/collect readiness.
5. **Manual recovery.** Every automatic change is undoable. Conflicts carry provenance: source, time, profile mode,
   old value and new value.
6. **Rights and patch safety.** Public data is a seed. Keep the patch version, source URL, source timestamp and a
   local override layer so updates never delete user corrections.

### Data schema from the spec

| Table | Fields |
| --- | --- |
| tasks | task_id, normalized_name, display_name_en, display_name_ru, trader_id, map_id, min_level, kappa_required, lightkeeper_required, wiki_url, source_version |
| task_requirements | task_id, required_task_id, required_status, min_level, trader_requirement, dialogue_requirement, delay_min, delay_max |
| task_objectives | objective_id, task_id, type, optional, target_count, item_ids, found_in_raid, dogtag_level, target_names, marker_item_id |
| quest_map_points | point_id, task_id, objective_id, map_id, world_x, world_y, world_z, outline_json, top, bottom, floor_hint, label, confidence, source |
| quest_items | task_id, objective_id, item_id, count, found_in_raid, max_durability, min_durability, accepted_substitutes_json |
| progress_events | profile_id, task_id, objective_id, event_type, old_value, new_value, source, confidence, observed_at, reversible |

### Known gaps the spec lists (not all in scope here)

- A translation resolver (names hydrated from GraphQL, wiki slugs, game localization or a local table).
- Visual evidence (screenshots) per map point with source/patch/license fields.
- PvP, PvE and Season separated everywhere (json.tarkov.dev `regular`, `pve`, `pvp-season`).
- Routes are objective-focused, never «safe route» guarantees.
- Licensing: tarkov.dev API is public for tools; screenshots/maps/wiki images may have other rights — keep source
  metadata.

Sources: json.tarkov.dev/endpoints, json.tarkov.dev/regular/{tasks,maps,items}, tarkov.dev/api,
github.com/TarkovTracker/tarkovdata.

## Gap analysis (state before this change)

| Spec item | What the app had | Gap |
| --- | --- | --- |
| Stable task identity | `ModeProgress.taskProgress` keyed by tarkov.dev task id; markers carry `questId`/`objectiveId`. | Legacy v1 state seeded `trackedTaskIds` / completed quests with slugs (`operation-aquarius`…); nothing ever rewrote them to ids. `Quest.objectiveIds` was filtered separately from `Quest.objectives`, so index alignment could break. |
| Objective state | Only quest-level status (`active/completed/failed`) and `currentStageIndex` for story chapters. The catalog kept objective descriptions and ids but dropped type, count and zones. | No per-objective state, counters, source, confidence or observed time. |
| Automatic sources | `electron/logScanner.ts` + `src/import/logParser.ts` read quest notifications (type 10/11/12 → accepted/failed/completed) per mode; screen OCR for the trader table and story stages. | EFT logs carry no objective counters, so objective progress from logs can only be derived from a quest completion. |
| Provenance / undo | `TaskProgressRecord.source` + `updatedAt`; newer record overwrites. | No history, no old→new, no undo, no confidence, no conflict prompts. |
| Conflict rules | `applyLogQuestState`: a manual record survives only when newer than the log event. | No «manual beats automatic» rule, no «ask before log completion overrides manual not-done». |
| Server storage | `quest_events` (log statuses per owner/mode/account/character), `/v1/me/progress/:mode`. Sync on sign-in and every 30 s. | Manual edits, OCR results, objectives and history never reached the server. |
| Override layer | Catalog cached in IndexedDB per mode+locale and replaced on refresh; `metadata.source/loadedAt`. | No user corrections layer; no upstream version/timestamp recorded. |
| Map points | `mapMarkerAdapter` builds Leaflet markers (projected positions) for the map page. | No normalized game-space view keyed by task+objective with outline/top/bottom/floor for other features. |

Roadmap note: `docs/product-roadmap-and-business-model.md` says users must not mark whole quests completed or
not completed by hand. This change keeps that: quest status stays automatic (logs/OCR/server). Manual editing is
offered per **objective** (counters and checkboxes), which the sync spec asks for as «manual recovery».

## What was built

- **Identity.** `normalizeTaskKeys()` (src/domain/progress.ts) rewrites legacy slug keys (task progress, tracked
  list, objective rows) to task ids once the live catalog is loaded; unknown keys are kept, never dropped.
  `Quest.objectiveDetails` (src/data/objectiveDetails.ts) keeps id, type, target, optional flag, item ids, zones and
  quest-item spots per objective in one record (no parallel arrays). Catalogs without objective ids fall back to
  position ids that are marked unstable.
- **Objective state per mode** (`ModeProgress.objectiveProgress`, keyed by `objectiveId`; profile schema v6 — v5
  profiles migrate with every value kept and empty objective state):
  `{ objectiveId, taskId, type, target, current, completedAt, source: log|ocr|manual|sync, confidence, observedAt }`.
  A quest completed by the log shows its objectives as done (derived, source `log`) unless the user said otherwise.
- **progress_events** (`ModeProgress.progressEvents`, capped locally) with mode, taskId, objectiveId, event type,
  old→new, source, confidence, time, reversible, undone. Task status changes from logs/OCR/sync are recorded too.
- **Conflict rules** (`src/progression/objectiveProgress.ts`, shared with the server):
  1. manual beats automatic (log/ocr/sync);
  2. within the same authority, newer `observedAt` wins (ties: higher confidence);
  3. a log-confirmed completion does not overwrite a manual «not done»: it is queued as a conflict and the quest
     view asks «Журнал подтверждает выполнение — отметить?» (accept / keep mine).
- **Undo.** «Отменить» on any automatic change in «История изменений» restores the old value as a manual record (so
  the next scan does not re-apply it) and marks the event undone.
- **Server.** `objective_progress` and `progress_events` tables per `user:<account>` + mode;
  `GET /v1/me/objectives/:mode`, `POST /v1/me/objectives/:mode/sync`,
  `POST /v1/me/objectives/:mode/events/:eventId/undo` (404 for an event of another account or mode; 409 for manual
  and task-status events, which are undone on the device). Limits: 2000 objectives / 1000 events per request, 5000
  objectives and the newest 3000 events per account and mode, client times clamped to server time + 60 s. The
  desktop/phone app syncs on sign-in, for all modes on reconnect, every 30 s for the current mode and ~3 s after a
  local change.
- **Override layer.** `src/progression/questOverrides.ts` (localStorage `tarkov-quest-overrides-v1`): user
  corrections (objective note, map point, hidden point) stored apart from the catalog with source, catalog
  source/version and timestamps; applied over every catalog refresh, flagged (not deleted) when the catalog version
  changed. The quest view edits objective notes. The catalog records `metadata.sourceUrl` / `sourceVersion`
  (Last-Modified / ETag of the tasks file) / `sourceUpdatedAt`.
- **quest_map_points.** `questMapPoints()` in `src/progression/questMapPoints.ts` is the one exported function for
  route/briefing/squad: normalized game-space rows from objective zones (and quest-item spawn points), merged with
  user map-point overrides. A GraphQL adapter for the tarkov.dev `tasks { objectives { ... on TaskObjectiveBasic
  { zones { ... } } } }` shape is included and tested on fixtures (the app itself loads the same zones from
  json.tarkov.dev).

## Not built / limits

- No objective counters are read from the game: EFT logs do not contain them, and OCR of the objective counters in
  the Tasks screen is not implemented. Objective progress is manual, derived from a logged completion, or synced.
- No inventory recognition (giveItem/collect readiness) and no live position claims.
- No map editor UI for map-point corrections yet (the data layer and `questMapPoints()` support them).
- Overrides stay on this computer (not synced to the server).
- Website cabinet does not show objective history yet; the server undo endpoint is ready for it.
- The app does not call the tarkov.dev GraphQL API; `TASK_OBJECTIVES_QUERY` + `adaptGraphqlTaskObjectives()` are
  tested on fixtures only (the sandbox cannot reach tarkov.dev).
- A catalog cached by an older build has no `objectiveDetails` until the next successful refresh; the quest view
  then falls back to the objective lines (checkboxes only, position ids).
