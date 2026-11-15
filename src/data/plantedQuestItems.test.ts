import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLiveCatalog } from './catalogSource'
import { QUEST_ITEM_PICTURES, withQuestItemPictures } from './questItemPictures'
import { questItemNeeds } from '../raidprep/keepList'

/**
 * Report 162 (owner, 15.11.2026): «не отображается диск с дезой, который нужно заложить. То есть это квестовый предмет, который
 * сначала нужно поднять, а потом заложить… пройдись по всей базе квестов». A quest item to plant is tarkov.dev's `questItem`
 * of a plantQuestItem objective; it is in no list of items, so «Требования рейда» never had it.
 */
const MECHANIC = '5a7c2eca46aef81a7ca2145d'
const BLOOD = '66a0f0926fee20fa70036da6'
const FOREND = '683ed6ccd9a096739b0c9228'
const DRIVE = '6a8993cab2713c27d90e9bb7'

const upstream: Record<string, unknown> = {
  tasks: {
    tasks: {
      // found and planted in the same quest: «Поднять и заложить»
      secret: {
        id: 'secret', name: 'Врачебная тайна. Часть 6', trader: MECHANIC,
        objectives: [
          { id: 'find', type: 'findQuestItem', description: 'Найти пробу крови', questItem: BLOOD, maps: ['m-lab'] },
          { id: 'plant', type: 'plantQuestItem', description: 'Заложить пробу крови', questItem: BLOOD, count: 1, maps: ['m-lab'] },
        ],
      },
      // found by an earlier quest: taken into the raid and planted
      club: {
        id: 'club', name: 'Клуб по интересам', trader: MECHANIC,
        objectives: [{ id: 'plant-forend', type: 'plantQuestItem', description: 'Заложить цевье AK-50', questItem: FOREND, maps: ['m-customs'] }],
      },
    },
    questItems: {
      [BLOOD]: { id: BLOOD, name: 'Проба крови', shortName: 'Кровь', width: 1, height: 1 },
      [FOREND]: { id: FOREND, name: 'Цевье и газовая трубка M-LOK для AK-50', shortName: 'AK-50', width: 2, height: 1 },
      unused: { id: 'unused', name: 'Флешка', shortName: 'Флешка' },
    },
  },
  maps: { maps: {
    'm-lab': { id: 'm-lab', name: 'Лаборатория', normalizedName: 'the-lab', extracts: [] },
    'm-customs': { id: 'm-customs', name: 'Таможня', normalizedName: 'customs' },
  } },
  traders: { [MECHANIC]: { id: MECHANIC, name: 'Механик' } },
}

afterEach(() => vi.unstubAllGlobals())

async function catalog(locale: 'ru' | 'en') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const match = /json\.tarkov\.dev\/[a-z-]+\/([a-z]+)(_[a-z]+)?$/.exec(String(url))
    if (!match) return new Response('', { status: 404 })
    return new Response(JSON.stringify({ data: match[2] ? {} : upstream[match[1]] ?? {} }), { status: 200 })
  }))
  return fetchLiveCatalog('pve', locale, undefined, { wiki: async () => ({ titles: [], pages: [], storyQuests: [] }), now: Date.parse('2026-11-15T12:00:00Z') })
}

describe('quest items to plant', () => {
  it('are in the raid requirements, picked up first where the same quest finds them', async () => {
    const data = await catalog('ru')
    const plants = (id: string) => data.quests.find((quest) => quest.id === id)!.raidRequirements!.filter((need) => need.questItem && need.purpose === 'place')
    expect(plants('secret')).toEqual([expect.objectContaining({ itemId: BLOOD, purpose: 'place', objectiveId: 'plant', questItem: true, pickUp: true })])
    expect(plants('club')).toEqual([expect.objectContaining({ itemId: FOREND, purpose: 'place', questItem: true })])
    expect(plants('club')[0]!.pickUp).toBeUndefined()
  })

  it('come with their names and the app\'s own pictures, only the ones planted', async () => {
    const data = withQuestItemPictures(await catalog('ru'))
    const names = new Map((data.questItems ?? []).map((item) => [item.id, item]))
    expect(names.get(BLOOD)).toMatchObject({ name: 'Проба крови', iconUrl: expect.stringContaining(`quest-items/${BLOOD}.webp`) })
    expect(names.get(FOREND)?.name).toBe('Цевье и газовая трубка M-LOK для AK-50')
    expect(names.has('unused')).toBe(false)
    // not one of the items of the market and the stash
    expect(data.items.some((item) => item.id === BLOOD)).toBe(false)
  })

  it('«На свет. Доверяй, но проверяй»: the hard drive with false data Mechanic gives', async () => {
    for (const locale of ['ru', 'en'] as const) {
      const data = withQuestItemPictures(await catalog(locale))
      const quest = data.quests.find((entry) => entry.name === (locale === 'ru' ? 'На свет. Доверяй, но проверяй' : 'To the Light - Trust but Verify'))!
      expect(quest.raidRequirements?.find((need) => need.itemId === DRIVE)).toMatchObject({ purpose: 'place', questItem: true })
      expect(quest.raidRequirements?.find((need) => need.itemId === DRIVE)?.pickUp).toBeUndefined()
      expect(data.questItems?.find((item) => item.id === DRIVE)).toMatchObject({ name: locale === 'ru' ? 'Жесткий диск с дезой' : 'Hard drive with false data', iconUrl: expect.stringContaining(`quest-items/${DRIVE}.webp`) })
    }
  })

  it('is nothing to keep in the stash', async () => {
    const data = await catalog('ru')
    expect([...questItemNeeds(data.quests.find((quest) => quest.id === 'club')!).keys()]).toEqual([])
  })

  it('has a picture file for every quest item it names', () => {
    expect(QUEST_ITEM_PICTURES.size).toBeGreaterThan(100)
    for (const id of QUEST_ITEM_PICTURES) expect(existsSync(join(process.cwd(), 'public', 'quest-items', `${id}.webp`)), id).toBe(true)
  })
})
