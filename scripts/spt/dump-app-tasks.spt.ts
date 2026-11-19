// Dumps the app's tasks per mode (tarkov.dev + the Season fixes and borrowed tasks + the curated series), as the catalog
// builds them, for the SPT comparison (scripts/spt/README.md). Run: SPT_TD_DIR=<dir> npx vitest run --config scripts/spt/vitest.config.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import { withBorrowedTasks, withSeasonTaskFixes } from '../../src/data/catalogSource'
import { withCuratedTasks, CURATED_SERIES } from '../../src/data/curatedQuests'

const DIR = process.env.SPT_TD_DIR as string
const read = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}.json`, 'utf8')).data

function translateDeep(value: unknown, dictionary: Record<string, unknown>): unknown {
  if (typeof value === 'string') return typeof dictionary[value] === 'string' ? dictionary[value] : value
  if (Array.isArray(value)) return value.map((entry) => translateDeep(entry, dictionary))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, translateDeep(entry, dictionary)]))
}

it('dumps', () => {
  const regularRaw = read('regular_tasks')
  for (const [mode, upstream] of [['pvp', 'regular'], ['pve', 'pve'], ['seasonal', 'pvp-season']] as const) {
    const dict = read(`${upstream}_tasks_ru`)
    let raw = read(`${upstream}_tasks`)
    let translated = translateDeep(raw, dict) as Record<string, unknown>
    if (upstream === 'pvp-season') {
      const regularDict = read('regular_tasks_ru')
      raw = withBorrowedTasks(raw, regularRaw)
      translated = withBorrowedTasks(translated, translateDeep(regularRaw, regularDict) as Record<string, unknown>)
      const rawEndpoint = { data: raw, dictionary: dict }
      translated = withSeasonTaskFixes(translated, rawEndpoint, 'ru')
      raw = rawEndpoint.data
    }
    const maps = translateDeep(read(`${upstream}_maps`), {}) as Record<string, unknown>
    const traders = read(`${upstream}_traders`)
    const curated = withCuratedTasks(translated, { mode, locale: 'ru', maps, traders, series: CURATED_SERIES, now: Date.now() })
    const curatedEn = withCuratedTasks(translateDeep(raw, read(`${upstream}_tasks_en`)) as Record<string, unknown>, { mode, locale: 'en', maps, traders, series: CURATED_SERIES, now: Date.now() })
    const addedTasks = Object.fromEntries([...curated.added].map((id) => [id, (curated.tasks.tasks as Record<string, unknown>)[id]]))
    const addedEn = Object.fromEntries([...curatedEn.added].map((id) => [id, (curatedEn.tasks.tasks as Record<string, unknown>)[id]]))
    writeFileSync(`${DIR}/app_${mode}.json`, JSON.stringify({ raw, dict, added: addedTasks, addedEn }))
  }
  const series = CURATED_SERIES.map((entry) => ({ id: entry.id, name: entry.name, modes: entry.modes, quests: entry.quests.map((quest) => ({ id: quest.id, name: quest.name, modes: quest.modes, hidden: quest.hidden, endsAt: quest.endsAt ?? entry.endsAt, otherIds: quest.otherIds })) }))
  writeFileSync(`${DIR}/curated_series.json`, JSON.stringify(series, null, 1))
}, 120_000)
