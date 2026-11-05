// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Item, Quest } from '../domain/types'
import type { DeferredQuest } from '../progression/deferredQuests'
import type { TaskAvailability } from '../progression/requirementEngine'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'
import { questKeyRows } from './questKeys'

const item = (id: string, name: string, category: Item['category'] = 'Ключ') => ({ id, name, shortName: name, category }) as unknown as Item
const ITEMS = new Map([item('k1', 'Ключ А'), item('k2', 'Ключ Б'), item('k3', 'Ключ В'), item('alt', 'Ключ Запасной'), item('meds', 'Аптечка', 'Медицина')].map((entry) => [entry.id, entry]))
const key = (itemId: string, extra: object = {}) => ({ itemId, purpose: 'key', count: 1, mapIds: ['customs'], ...extra })
const quest = (id: string, requirements: object[], extra: object = {}) => ({ id, name: id, normalizedName: id, trader: 'Прапор', level: 5, raidRequirements: requirements, ...extra }) as unknown as Quest
const status = (entries: Record<string, TaskAvailability['status']>) => new Map(Object.entries(entries).map(([id, value]) => [id, { status: value, blockers: [] }]))
const PROGRESS = { taskProgress: {}, faction: 'usec' as const }
const NONE = new Map<string, DeferredQuest>()

describe('«Ключи для квестов»', () => {
  it('a key shared by quests holds all of them, and leaves only when all are done', () => {
    const quests = [quest('q1', [key('k1')]), quest('q2', [key('k1')]), quest('q3', [key('k2')])]
    const first = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'active', q2: 'locked', q3: 'available' }), NONE)
    expect(first.map((row) => [row.item.id, row.state, row.needed.map((use) => use.quest.id)])).toEqual([['k1', 'needed', ['q1', 'q2']], ['k2', 'needed', ['q3']]])

    // One done: it leaves the key's list, the key stays.
    const second = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'completed', q2: 'active', q3: 'available' }), NONE)
    const k1 = second.find((row) => row.item.id === 'k1')!
    expect([k1.state, k1.needed.map((use) => use.quest.id), k1.done.map((use) => use.quest.id)]).toEqual(['needed', ['q2'], ['q1']])

    // All done: no longer needed, with its quests to go to.
    const third = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'completed', q2: 'completed', q3: 'available' }), NONE)
    const gone = third.find((row) => row.item.id === 'k1')!
    expect([gone.state, gone.needed, gone.done.map((use) => use.quest.id)]).toEqual(['done', [], ['q1', 'q2']])
  })

  it('a quest put aside no longer holds its key; with another quest the key stays needed', () => {
    const quests = [quest('q1', [key('k1')]), quest('q2', [key('k1')]), quest('q3', [key('k2')])]
    const aside = new Map<string, DeferredQuest>([['q1', { at: 1 }], ['q3', { at: 1 }]])
    const rows = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'active', q2: 'active', q3: 'active' }), aside)
    const k1 = rows.find((row) => row.item.id === 'k1')!
    expect([k1.state, k1.needed.map((use) => use.quest.id), k1.deferred.map((use) => use.quest.id)]).toEqual(['needed', ['q2'], ['q1']])
    expect(rows.find((row) => row.item.id === 'k2')!.state).toBe('deferred')
    // A quest done while put aside counts as done.
    const done = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'completed', q2: 'completed' }), aside)
    expect(done.find((row) => row.item.id === 'k1')!.state).toBe('done')
  })

  it('only keys: not the other things a quest takes, not an optional key, not a failed quest or the other faction', () => {
    const quests = [
      quest('q1', [{ itemId: 'meds', purpose: 'bring', count: 1, mapIds: [] }, key('k2', { optional: true })]),
      quest('q2', [key('k1')]),
      quest('q3', [key('k3')], { faction: 'BEAR' }),
    ]
    const rows = questKeyRows(quests, ITEMS, PROGRESS, status({ q1: 'active', q2: 'failed', q3: 'active' }), NONE)
    expect(rows).toEqual([])
  })

  it('a key named only among the required items counts; one the catalog does not know does not', () => {
    const rows = questKeyRows([quest('q1', [], { requiredItems: ['k3', 'meds', 'unknown'], mapIds: ['woods'] })], ITEMS, PROGRESS, status({ q1: 'active' }), NONE)
    expect(rows.map((row) => [row.item.id, row.mapIds])).toEqual([['k3', ['woods']]])
  })

  it('a hand-in of any key is not a list of quest keys', () => {
    const many = Array.from({ length: 20 }, (_, index) => item(`any-${index}`, `Любой ключ ${index}`))
    const items = new Map([...ITEMS, ...many.map((entry) => [entry.id, entry] as const)])
    const rows = questKeyRows([quest('q1', [], { requiredItems: many.map((entry) => entry.id) }), quest('q2', [key('k1')])], items, PROGRESS, status({ q1: 'active', q2: 'active' }), NONE)
    expect(rows.map((row) => row.item.id)).toEqual(['k1'])
  })

  it('keys that replace each other say so', () => {
    const rows = questKeyRows([quest('q1', [key('k1', { objectiveId: 'o1', alternatives: 2 }), key('alt', { objectiveId: 'o1', alternatives: 2 })])], ITEMS, PROGRESS, status({ q1: 'active' }), NONE)
    expect(rows.find((row) => row.item.id === 'k1')!.needed[0]!.alternatives).toEqual(['alt'])
  })

  it('story chapters count too, each with its mode\'s own progress', () => {
    // A key of a chapter's guide; the items of the catalog name it.
    const chapter = STORY_CHAPTER_SEEDS.find((entry) => entry.id === 'they-are-already-here')!
    const story = { id: `story-${chapter.id}`, name: chapter.ru, nameRu: chapter.ru, normalizedName: chapter.id, kind: 'story', trader: 'История', level: 0 } as unknown as Quest
    const keyId = '5e42c81886f7742a01529f57'
    const items = new Map([[keyId, item(keyId, 'Ключ из главы')]])
    const needed = questKeyRows([story], items, PROGRESS, status({ [story.id]: 'active' }), NONE)
    const done = questKeyRows([story], items, PROGRESS, status({ [story.id]: 'completed' }), NONE)
    expect(needed.length).toBeLessThanOrEqual(1)
    if (needed.length) {
      expect(needed[0]!.state).toBe('needed')
      expect(done[0]!.state).toBe('done')
    }
  })
})
