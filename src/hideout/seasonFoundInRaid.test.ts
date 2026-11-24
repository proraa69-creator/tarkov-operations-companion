import { describe, expect, it } from 'vitest'
import type { HideoutStation } from '../domain/types'
import PVP_MARKS from './pvpHideoutFoundInRaid.json'
import { withSeasonFoundInRaid } from './seasonFoundInRaid'

const [stationId, level, itemId] = PVP_MARKS[0]!.split(':') as [string, string, string]
const station = (fir?: boolean): HideoutStation => ({
  id: stationId, name: 'Модуль', level: 0, status: 'locked', requirements: [], bonus: '',
  levels: [{ level: Number(level), itemRequirements: [{ itemId, count: 1, ...(fir === undefined ? {} : { foundInRaid: fir }) }, { itemId: 'other', count: 2 }] }],
} as unknown as HideoutStation)

describe('«Только найдено в рейде» in «Сезон»', () => {
  it('a Season catalog without any found-in-raid mark takes PvP\'s marks, only for the requirements PvP marks', () => {
    const [result] = withSeasonFoundInRaid([station()], 'seasonal')
    expect(result!.levels![0]!.itemRequirements!.map((requirement) => requirement.foundInRaid)).toEqual([true, undefined])
  })

  it('PvP and PvE keep their own data; a Season catalog that marks something keeps its own too', () => {
    const own = [station()]
    expect(withSeasonFoundInRaid(own, 'pvp')).toBe(own)
    const marked = [station(false), { ...station(), id: 'x', levels: [{ level: 1, itemRequirements: [{ itemId: 'y', count: 1, foundInRaid: true }] }] } as unknown as HideoutStation]
    expect(withSeasonFoundInRaid(marked, 'seasonal')).toBe(marked)
  })
})
