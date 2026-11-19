# Сверка квестов с базой SPT

Скрипты, по которым сделана сверка `docs/quests/spt-sync-2026-11-20.md`. База SPT только читается
(`E:\SPT\SPT_Runtime\SPT_Data\database`). Живую игру на D: скрипты не трогают.

`<work>` — любая папка для промежуточных файлов (не в репозитории). Команды из корня репозитория:

```powershell
node scripts/spt/fetch-tarkov-dev.mjs <work>/td
$env:SPT_TD_DIR = "<work>/td"; npx vitest run --config scripts/spt/vitest.config.ts
node scripts/spt/compare-quests.mjs <work>/td <work>/cmp_result.json
node scripts/spt/quest-item-spawns.mjs <work>/td <work>/loot_result.json
node scripts/spt/missing-quest-item-spots.mjs <work>/td <work>/extra_result.json
node scripts/spt/guaranteed-spawns.mjs <work>/td <work>/g100_result.json
node scripts/spt/diff-csv.mjs <work> <work>/spt-sync-diff.csv
```

- `fetch-tarkov-dev.mjs` — квесты, предметы, карты и торговцы tarkov.dev для PvP, PvE и Сезона.
- `dump-app-tasks.spt.ts` — квесты так, как их собирает приложение: правки Сезона, квесты, которые Сезон берёт у PvP, наши серии.
- `compare-quests.mjs` — сравнение по квестам и целям: опыт, награды, уровни, цепочки, фракция, провал, задержки.
- `quest-item-spawns.mjs` — закреплённые места квестовых предметов (`spawnpointsForced`) против мест tarkov.dev.
- `missing-quest-item-spots.mjs` — места, которых нет в целях «найти» (основа `src/data/questItemSpots.ts`).
- `guaranteed-spawns.mjs` — точки «всегда здесь», группы «всегда одна из N» и предметы, закреплённые за контейнерами
  (основа `src/data/guaranteedSpawns.ts`).
- `diff-csv.mjs` — полный список расхождений для Excel.

Перед тем как переносить что-то в приложение, сверяйте число мест с вики или с живыми точками tarkov.dev: база SPT 4.1.6
относится к версии игры 0.16.9.
