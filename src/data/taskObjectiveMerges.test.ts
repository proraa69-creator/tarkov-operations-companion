import { describe, expect, it } from 'vitest'
import { withTaskObjectiveMerges } from './catalogSource'

// «Ревизия. Маяк» (a player's report, 27.11.2026: in the game one BRDM and one Stryker, any of three places each).
const REVISION = '6179b4d1bca27a099552e04e'
const BRDM = '61952308aa0f643f9a0ae20f'
const SECOND_BRDM = '6195231dd07bdc6de57b40a5'
const STRYKER = '61952325aa0f643f9a0ae212'
const SECOND_STRYKER = '6195232a1e972a652931edb6'
const zone = (id: string) => ({ id, map: '5704e4dad2720bb55b8b4567', position: { x: 1, y: 0, z: 1 } })
const objective = (id: string, zones: string[]) => ({ id, type: 'mark', description: `text of ${id}`, zones: zones.map(zone) })
// tarkov.dev's PvP: a first and a second BRDM and Stryker, one place each, two places missing
const pvp = () => [objective(BRDM, ['qlight_mark_vech1']), objective(SECOND_BRDM, ['qlight_mark_vech2']), objective(STRYKER, ['qlight_mark_vech3']), objective(SECOND_STRYKER, ['qlight_mark_vech4'])]
// its PvE: the game's two objectives with all six places
const pve = () => [objective(BRDM, ['qlight_mark_vech1', 'qlight_mark_vech6', 'qlight_mark_vech2']), objective(STRYKER, ['qlight_mark_vech3', 'qlight_mark_vech4', 'qlight_mark_vech5'])]

type Objective = ReturnType<typeof objective>
function merged(objectives: Objective[], locale: 'ru' | 'en' = 'ru') {
  // the translated data has the objective's text as its id, at the same place as the untranslated one
  const translated = { tasks: { [REVISION]: { id: REVISION, objectives: objectives.map((entry) => ({ ...entry, id: entry.description })) }, other: { id: 'other', objectives: [objective('x', ['z'])] } } }
  const raw: { data?: unknown } = { data: { tasks: { [REVISION]: { id: REVISION, objectives }, other: { id: 'other', objectives: [objective('x', ['z'])] } } } }
  const tasks = withTaskObjectiveMerges(translated as never, raw as never, locale) as unknown as typeof translated
  const rawTasks = (raw.data as { tasks: Record<string, { objectives: Objective[] }> }).tasks
  return { translated: tasks.tasks[REVISION].objectives, raw: rawTasks[REVISION]!.objectives, other: tasks.tasks.other.objectives }
}
const zoneIds = (entry: { zones: Array<{ id: string }> }) => entry.zones.map((each) => each.id)

describe('«Ревизия. Маяк»: one BRDM and one Stryker, any of three places each (TASK_OBJECTIVE_MERGES)', () => {
  it('PvP: the second BRDM and Stryker go, their places and the two missing ones join the first, under the game\'s ids', () => {
    const { translated, raw, other } = merged(pvp())
    expect(raw.map((entry) => entry.id)).toEqual([BRDM, STRYKER])
    expect(translated.map((entry) => entry.id)).toEqual([`text of ${BRDM}`, `text of ${STRYKER}`])
    expect(translated.map(zoneIds)).toEqual([['qlight_mark_vech1', 'qlight_mark_vech6', 'qlight_mark_vech2'], ['qlight_mark_vech3', 'qlight_mark_vech4', 'qlight_mark_vech5']])
    expect(raw.map(zoneIds)).toEqual(translated.map(zoneIds))
    expect(translated.map((entry) => entry.description)).toEqual([
      'Найти и пометить любую из трёх БРДМ Маркером MS2000 на локации Маяк',
      'Найти и пометить любой из трёх Stryker Маркером MS2000 на локации Маяк',
    ])
    // the places PvP's data lacks are the PvE data's own
    expect(translated[0]!.zones[1]).toMatchObject({ id: 'qlight_mark_vech6', position: { x: 8.42, z: 173.83 }, top: 8.92, bottom: 5.92 })
    expect(translated[1]!.zones[2]).toMatchObject({ id: 'qlight_mark_vech5', position: { x: 187.4, z: -709.75 } })
    // the untranslated text stays (only the translated data carries the description shown)
    expect(raw[0]!.description).toBe(`text of ${BRDM}`)
    expect(other).toHaveLength(1)
  })

  it('PvE: already the game\'s two objectives — the same places in the same order, none twice; the text says «any»', () => {
    const { translated } = merged(pve(), 'en')
    expect(translated.map(zoneIds)).toEqual([['qlight_mark_vech1', 'qlight_mark_vech6', 'qlight_mark_vech2'], ['qlight_mark_vech3', 'qlight_mark_vech4', 'qlight_mark_vech5']])
    expect(translated[0]!.zones[1]!.position).toEqual({ x: 1, y: 0, z: 1 })
    expect(translated.map((entry) => entry.description)).toEqual([
      'Locate and mark any of the three BRDMs with an MS2000 Marker on Lighthouse',
      'Locate and mark any of the three Strykers with an MS2000 Marker on Lighthouse',
    ])
  })
})
