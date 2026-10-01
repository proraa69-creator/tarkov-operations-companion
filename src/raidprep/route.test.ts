import { describe, expect, it } from 'vitest'
import { bestStartExtract, orderRoute, planRoute, routeLength, routeTargets, stepNumber, type RouteTarget } from './route'
import { marker, progressWith, quest } from './fixtures'

const target = (id: string, position: [number, number], group = id): RouteTarget => ({ id, position, group, title: id })

function permutations<T>(list: T[]): T[][] {
  if (list.length <= 1) return [list]
  return list.flatMap((entry, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [entry, ...rest]))
}

describe('orderRoute', () => {
  it('visits points along a line in order from the start', () => {
    const route = orderRoute([0, 0], [target('c', [30, 0]), target('a', [10, 0]), target('b', [20, 0])])
    expect(route.map((step) => step.id)).toEqual(['a', 'b', 'c'])
  })

  it('finds the shortest open path on a small set (nearest neighbour + 2-opt)', () => {
    const points = [target('a', [0, 10]), target('b', [10, 11]), target('c', [10, 0]), target('d', [0, 21]), target('e', [10, 22]), target('f', [-8, 3])]
    const route = orderRoute([0, 0], points)
    expect(new Set(route.map((step) => step.id)).size).toBe(points.length)
    const best = Math.min(...permutations(points).map((order) => routeLength([0, 0], order)))
    expect(routeLength([0, 0], route)).toBeLessThanOrEqual(best * 1.05)
  })

  it('2-opt untangles a crossing the greedy order leaves', () => {
    // Nearest neighbour alone goes p1 → p4 → p3 → p2 → p5 here; the result must match the brute-force optimum.
    const points = [target('p1', [0, 1]), target('p2', [5, 1.2]), target('p3', [5, -1]), target('p4', [0, -1.4]), target('p5', [10, 0])]
    const route = orderRoute([0, 0], points)
    const best = Math.min(...permutations(points).map((order) => routeLength([0, 0], order)))
    expect(routeLength([0, 0], route)).toBeCloseTo(best, 5)
  })

  it('visits one candidate of a group of alternatives, the one that fits the path', () => {
    const route = orderRoute([0, 0], [target('a', [10, 0]), target('spot-far', [100, 100], 'obj'), target('spot-near', [20, 0], 'obj')])
    expect(route.map((step) => step.id)).toEqual(['a', 'spot-near'])
  })

  it('returns an empty route without targets', () => {
    expect(orderRoute([0, 0], [])).toEqual([])
  })
})

describe('bestStartExtract and routeTargets', () => {
  it('picks the extract giving the shortest route', () => {
    const extracts = [{ id: 'far', position: [500, 500] as [number, number] }, { id: 'near', position: [0, 0] as [number, number] }]
    expect(bestStartExtract(extracts, [target('a', [5, 0]), target('b', [10, 0])])?.id).toBe('near')
    expect(bestStartExtract([], [target('a', [5, 0])])).toBeUndefined()
  })

  it('takes plotted points of current quests on the map only', () => {
    const quests = [quest('q1', 'Текущее'), quest('q2', 'Не принято')]
    const markers = [
      marker('m1', [1, 1], { questId: 'q1', objectiveId: 'o1' }),
      marker('m2', [2, 2], { questId: 'q2' }),
      marker('m3', [3, 3], { questId: 'q1', approximate: true }),
      marker('m4', [4, 4], { questId: 'q1', mapId: 'woods' }),
      marker('m5', [5, 5], { questId: 'q1', source: 'quest-fallback' }),
      marker('m6', [6, 6], { layerId: 'extract.pmc', type: 'extract' }),
    ]
    expect(routeTargets(markers, quests, progressWith({ q1: 'active' }), 'customs').map((entry) => [entry.id, entry.group])).toEqual([['m1', 'o1']])
  })

  it('labels a step by its objective and skips objectives already done', () => {
    const quests = [quest('q1', 'Текущее', { objectiveDetails: [
      { id: 'o1', type: 'mark', description: 'Отметить бензовоз', mapIds: ['customs'], zoneBound: true },
      { id: 'o2', type: 'visit', description: 'Посетить общагу', mapIds: ['customs'], zoneBound: true },
    ] })]
    const markers = [
      marker('m1', [1, 1], { questId: 'q1', objectiveId: 'o1', title: 'Текущее', floor: 'Подвал' }),
      marker('m2', [2, 2], { questId: 'q1', objectiveId: 'o2', title: 'Текущее' }),
    ]
    const progress = progressWith({ q1: 'active' })
    expect(routeTargets(markers, quests, progress, 'customs').map((entry) => [entry.title, entry.objectiveType, entry.floor])).toEqual([
      ['Отметить бензовоз', 'mark', 'Подвал'],
      ['Посетить общагу', 'visit', undefined],
    ])
    progress.taskProgress.q1 = { ...progress.taskProgress.q1, ...{ objectives: { o2: { completed: true } } } }
    expect(routeTargets(markers, quests, progress, 'customs').map((entry) => entry.id)).toEqual(['m1'])
  })

  it('numbers steps with circled digits', () => {
    expect([0, 1, 9].map(stepNumber).join('→')).toBe('①→②→⑩')
    expect(stepNumber(20)).toBe('(21)')
  })
})

describe('planRoute', () => {
  const quests = [quest('q1', 'Текущее')]
  const markers = [
    marker('a', [10, 0], { questId: 'q1', objectiveId: 'o1' }),
    marker('b', [20, 0], { questId: 'q1', objectiveId: 'o2' }),
    marker('ex-west', [0, 0], { layerId: 'extract.pmc', type: 'extract', title: 'Запад' }),
    marker('ex-east', [200, 0], { layerId: 'extract.pmc', type: 'extract', title: 'Восток' }),
  ]
  const progress = progressWith({ q1: 'active' })

  it('starts at the best extract by default', () => {
    const plan = planRoute(markers, quests, progress, 'customs', null)
    expect(plan).toMatchObject({ startExtract: 'Запад', startIsCustom: false, start: [0, 0], length: 20 })
    expect(plan.steps.map((step) => step.id)).toEqual(['a', 'b'])
  })

  it('starts where the user clicked', () => {
    const plan = planRoute(markers, quests, progress, 'customs', [25, 0])
    expect(plan.startIsCustom).toBe(true)
    expect(plan.steps.map((step) => step.id)).toEqual(['b', 'a'])
  })

  it('has no steps without current quests', () => {
    expect(planRoute(markers, quests, progressWith({}), 'customs', null).steps).toEqual([])
  })
})
