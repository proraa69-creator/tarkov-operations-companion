import { describe, expect, it } from 'vitest'
import type { Quest, RaidMode } from '../../domain/types'
import { questRequirements } from '../../progression/questBasics'
import fixture from './questTree.catalog.fixture.json'
import { layoutQuestTree, TREE_SIZE, type TreeBox } from './questTreeLayout'
import { buildQuestTree, isChipLink, isQuestTreeQuest, questChain, searchQuestTree, type QuestTreeModel } from './questTreeModel'

// The real quests of all three modes as the app's pipeline builds them (questTreeFixture.gen.test.ts rewrites the file).
const catalog = (mode: RaidMode) => fixture.modes[mode].map((place) => fixture.quests[place] as unknown as Quest)
const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

const quest = (id: string, extra: Partial<Quest> = {}): Quest => ({
  id, name: id, trader: 'Прапор', traderId: 'prapor', level: 1, kappa: false, description: '', objectives: [], rewards: [], requirements: [], ...extra,
})
const needs = (...ids: string[]) => ({ requirements: ids.map((taskId) => ({ taskId, allowedStatuses: ['complete' as const] })) })

/** The depth-first check the tree's links must pass: no quest leads back to itself. */
function circles(model: QuestTreeModel) {
  const state = new Map<string, 1 | 2>()
  let found = 0
  const visit = (id: string) => {
    state.set(id, 1)
    for (const link of model.outgoing.get(id) ?? []) {
      if (state.get(link.to) === 1) found += 1
      else if (!state.has(link.to)) visit(link.to)
    }
    state.set(id, 2)
  }
  for (const id of model.quests.keys()) if (!state.has(id)) visit(id)
  return found
}

const overlap = (a: TreeBox, b: TreeBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

describe.each(MODES)('the real catalog of %s', (mode) => {
  const quests = catalog(mode)
  const model = buildQuestTree(quests)
  const layout = layoutQuestTree(model)

  it('has every quest of the catalog exactly once', () => {
    const wanted = quests.filter(isQuestTreeQuest).map((entry) => entry.id).sort()
    expect(wanted.length).toBeGreaterThan(400)
    expect(model.lanes.flatMap((lane) => lane.questIds).sort()).toEqual(wanted)
    expect(layout.boxes.filter((box) => box.kind === 'quest').map((box) => box.questId).sort()).toEqual(wanted)
  })

  it('leaves out only what the catalog does not list either: a chapter\'s inner objectives and bare wiki pages', () => {
    for (const entry of quests.filter((row) => !isQuestTreeQuest(row))) expect(Boolean(entry.storyChapterId) || entry.id.startsWith('wiki:'), entry.name).toBe(true)
  })

  it('has no circles and loses no requirement', () => {
    expect(model.broken).toEqual([])
    expect(circles(model)).toBe(0)
    for (const entry of quests.filter(isQuestTreeQuest)) {
      const requirements = new Set(questRequirements(entry).map((requirement) => requirement.taskId))
      const drawn = (model.incoming.get(entry.id) ?? []).length
      const lost = model.unresolved.filter((row) => row.questId === entry.id).length
      expect(drawn + lost, entry.name).toBe(requirements.size)
    }
  })

  it('a chain reads left to right and nothing overlaps', () => {
    for (const [child, parent] of model.parentOf) {
      expect(layout.questBoxes.get(child)!.x, `${parent} → ${child}`).toBeGreaterThan(layout.questBoxes.get(parent)!.x)
    }
    const byLane = new Map<string, TreeBox[]>()
    for (const box of layout.boxes) byLane.set(box.laneKey, [...(byLane.get(box.laneKey) ?? []), box])
    for (const boxes of byLane.values()) {
      for (let a = 0; a < boxes.length; a += 1) {
        for (let b = a + 1; b < boxes.length; b += 1) {
          if (overlap(boxes[a], boxes[b])) expect.fail(`${boxes[a].key} / ${boxes[b].key}`)
        }
      }
    }
    for (const box of layout.boxes) {
      expect(box.x + box.width).toBeLessThanOrEqual(layout.width)
      expect(box.y + box.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('draws every link: a line inside a stage, a chip on both sides otherwise', () => {
    const lined = model.links.filter((link) => !isChipLink(link)).length
    const chips = model.links.filter(isChipLink).length
    expect(lined + chips).toBe(model.links.length)
    expect(layout.edges.filter((edge) => edge.key.startsWith('link:'))).toHaveLength(lined)
    expect(layout.boxes.filter((box) => box.kind === 'chip' && box.direction === 'in')).toHaveLength(chips)
    expect(layout.boxes.filter((box) => box.kind === 'chip' && box.direction === 'out')).toHaveLength(chips)
    expect(layout.edges.filter((edge) => edge.key.startsWith('chip:'))).toHaveLength(chips * 2)
  })

  it('no line runs from right to left', () => {
    for (const edge of layout.edges.filter((row) => row.key.startsWith('link:') || row.key.startsWith('chip:'))) {
      const [start, end] = [...edge.path.matchAll(/^M(-?[\d.]+)|(-?[\d.]+) -?[\d.]+$/g)].map((match) => Number(match[1] ?? match[2]))
      expect(end, edge.key).toBeGreaterThan(start)
    }
  })

  it('gives each lane in the same order, the story last, and one trader\'s tree on its own', () => {
    expect(model.lanes.map((lane) => lane.trader).slice(0, 2)).toEqual(['Прапор', 'Терапевт'])
    expect(model.lanes[model.lanes.length - 1].story).toBe(true)
    const prapor = model.lanes[0]
    const alone = layoutQuestTree(model, new Set([prapor.key]))
    expect(alone.bands.map((band) => band.lane.trader)).toEqual(['Прапор'])
    expect([...alone.questBoxes.keys()].sort()).toEqual([...prapor.questIds].sort())
  })
})

describe('real links', () => {
  const model = buildQuestTree(catalog('pvp'))
  const byName = (name: string) => [...model.quests.values()].find((entry) => entry.name === name)!

  it('a chain follows its requirements', () => {
    const first = byName('Как в старые добрые. Часть 1')
    const next = byName('Ад на земле. Часть 1')
    expect(model.outgoing.get(first.id)?.map((link) => link.to)).toContain(next.id)
    expect(model.parentOf.get(next.id)).toBe(first.id)
    expect(model.ranks.get(next.id)).toBeGreaterThan(model.ranks.get(first.id)!)
  })

  it('a link between traders is marked as one', () => {
    expect(model.links.filter((link) => link.crossLane).length).toBeGreaterThan(30)
  })

  it('a line\'s quests hang from their level, in the line\'s order, left to right on one loyalty level\'s row', () => {
    const prapor = model.lanes[0]
    const steps = prapor.steps.filter((step) => step.kind === 'line' && step.order === 1)
    expect(steps.map((step) => step.level)).toEqual([1, 3, 5])
    expect(steps[0].roots.map((id) => model.quests.get(id)!.name).sort()).toEqual(['Компромат', 'Пикник со стрельбой'])
    const layout = layoutQuestTree(model, new Set([prapor.key]))
    const boxes = steps.map((step) => layout.boxes.find((box) => box.step === step)!)
    expect(new Set(boxes.map((box) => box.y)).size).toBe(1)
    expect(boxes[0].x).toBeLessThan(boxes[1].x)
    expect(boxes[1].x).toBeLessThan(boxes[2].x)
    // the second loyalty level is a row of its own, under the first
    const second = layout.boxes.find((box) => box.step?.ll === 2)!
    expect(second.y).toBeGreaterThan(boxes[0].y)
    expect(second.x).toBe(boxes[0].x)
    for (const root of steps[1].roots) expect(layout.questBoxes.get(root)!.y).toBeGreaterThan(boxes[1].y)
  })

  it('a branch keeps its kind: taken or failed is not «handed in»', () => {
    const reagent = byName('Реагент. Часть 4')
    const kinds = new Map(model.outgoing.get(reagent.id)!.map((link) => [model.quests.get(link.to)!.name, link.kind]))
    expect(kinds.get('Большой заказчик')).toBe('active')
    expect(kinds.get('Выкуп доверия')).toBe('failed')
  })

  it('finds a quest by its title in any case, ё or е', () => {
    expect(searchQuestTree(model, 'как в старые')).toContain(byName('Как в старые добрые. Часть 1').id)
    expect(searchQuestTree(model, '')).toEqual([])
    expect(searchQuestTree(model, 'такого квеста нет')).toEqual([])
  })
})

describe('small trees', () => {
  it('a chain, with what comes before and after the chosen quest', () => {
    const model = buildQuestTree([quest('a'), quest('b', needs('a')), quest('c', needs('b')), quest('other')])
    expect(model.ranks.get('c')).toBe(3)
    expect([...questChain(model, 'b')].sort()).toEqual(['a', 'b', 'c'])
    expect(model.lanes[0].steps.flatMap((step) => step.roots).sort()).toEqual(['a', 'other'])
  })

  it('a quest with two earlier quests hangs from the later one and keeps both lines', () => {
    const model = buildQuestTree([quest('a'), quest('b', needs('a')), quest('c', needs('a', 'b'))])
    expect(model.parentOf.get('c')).toBe('b')
    expect(model.incoming.get('c')).toHaveLength(2)
    expect(layoutQuestTree(model).edges.filter((edge) => edge.to === 'c' && edge.key.startsWith('link:'))).toHaveLength(2)
  })

  it('broken data: a circle is cut, no quest is lost and nothing hangs', () => {
    const model = buildQuestTree([quest('a', needs('c')), quest('b', needs('a')), quest('c', needs('b')), quest('self', needs('self'))])
    expect(model.broken).toHaveLength(1)
    expect(circles(model)).toBe(0)
    expect(model.lanes.flatMap((lane) => lane.questIds).sort()).toEqual(['a', 'b', 'c', 'self'])
    expect(layoutQuestTree(model).questBoxes.size).toBe(4)
  })

  it('a requirement on an unknown quest is noted, the quest stays', () => {
    const model = buildQuestTree([quest('a', needs('gone'))])
    expect(model.unresolved).toEqual([{ questId: 'a', taskId: 'gone' }])
    expect(model.lanes[0].questIds).toEqual(['a'])
  })

  it('a requirement on a chapter\'s inner objective leads to the chapter', () => {
    const model = buildQuestTree([
      quest('story-tour', { kind: 'story', trader: 'Глава истории', traderId: undefined, normalizedName: 'tour', storyOrder: 1 }),
      quest('inner', { storyChapterId: 'tour' }),
      quest('a', needs('inner')),
    ])
    expect(model.links).toEqual([{ from: 'story-tour', to: 'a', kind: 'complete', crossLane: true }])
    expect(model.quests.has('inner')).toBe(false)
  })

  it('an extra requirement from another stage of the trader is a chip on both sides, not a line across the tree', () => {
    const line = (id: string, level: number) => ({ unlock: { lines: [{ id, level, order: 1, ll: 1 }] } })
    const model = buildQuestTree([quest('a', line('l', 1)), quest('b', line('l', 3)), quest('b2', { ...needs('b'), ...line('l', 3) }), quest('c', { requirements: [...needs('b2').requirements, ...needs('a').requirements], ...line('l', 3) })])
    const apart = model.links.find((link) => link.from === 'a' && link.to === 'c')!
    expect(apart.apart).toBe(true)
    expect(model.parentOf.get('c')).toBe('b2')
    const layout = layoutQuestTree(model)
    expect(layout.edges.some((edge) => edge.key === 'link:a:c')).toBe(false)
    expect(layout.boxes.filter((box) => box.kind === 'chip').map((box) => [box.direction, box.questId, box.laneKey]).sort()).toEqual([['in', 'a', 'prapor'], ['out', 'c', 'prapor']])
  })

  it('another trader\'s quest stands before a first quest and is shown on both sides', () => {
    const model = buildQuestTree([quest('a'), quest('b', { ...needs('a'), trader: 'Терапевт', traderId: 'therapist' })])
    expect(model.ranks.get('b')).toBe(2)
    const layout = layoutQuestTree(model)
    const chips = layout.boxes.filter((box) => box.kind === 'chip')
    expect(chips.map((box) => [box.direction, box.questId, box.laneKey]).sort()).toEqual([['in', 'a', 'therapist'], ['out', 'b', 'prapor']])
    const chipIn = chips.find((box) => box.direction === 'in')!
    expect(chipIn.x).toBeLessThan(layout.questBoxes.get('b')!.x)
    expect(chipIn.height).toBe(TREE_SIZE.chipHeight)
  })
})
