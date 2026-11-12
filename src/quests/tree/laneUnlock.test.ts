import { describe, expect, it } from 'vitest'
import type { Quest } from '../../domain/types'
import fixture from './questTree.catalog.fixture.json'
import { buildQuestTree } from './questTreeModel'
import { laneUnlock } from './laneUnlock'

// the PvP catalog of the snapshot, as questTree.test.ts reads it
const quests = fixture.modes.pvp.map((place) => fixture.quests[place] as unknown as Quest)

describe('how a trader opens (report 133: «как открыть смотрителя»)', () => {
  const model = buildQuestTree(quests)
  const lightkeeper = model.lanes.find((lane) => lane.traderId === '638f541a29ffd1183d187f57')!

  it('Lightkeeper: other traders\' quests first, every quest on the way to them, and the lane\'s quest that shows it', () => {
    const unlock = laneUnlock(model, lightkeeper.key)!
    expect(unlock).toBeDefined()
    expect(unlock.first.length).toBeGreaterThan(0)
    expect(unlock.first.every((id) => model.laneOf.get(id) !== lightkeeper.key)).toBe(true)
    expect(unlock.path.length).toBeGreaterThanOrEqual(unlock.first.length)
    expect(unlock.first.every((id) => unlock.path.includes(id))).toBe(true)
    expect(unlock.path.every((id) => model.laneOf.get(id) !== lightkeeper.key)).toBe(true)
    expect(model.laneOf.get(unlock.start)).toBe(lightkeeper.key)
    // the snapshot: Mechanic's «На свет. Новое знакомство» opens «Источник информации», the line most of Lightkeeper's quests follow
    expect(unlock.first.map((id) => model.quests.get(id)!.name)).toEqual(['На свет. Новое знакомство'])
    expect(model.quests.get(unlock.start)!.name).toBe('Источник информации')
  })

  it('a trader whose quests need only his own: nothing to show', () => {
    const prapor = model.lanes.find((lane) => lane.traderId === '54cb50c76803fa8b248b4571')!
    const unlock = laneUnlock(model, prapor.key)
    if (unlock) expect(unlock.first.every((id) => model.laneOf.get(id) !== prapor.key)).toBe(true)
  })
})
