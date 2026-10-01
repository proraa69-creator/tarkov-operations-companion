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
