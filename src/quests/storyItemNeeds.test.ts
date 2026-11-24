import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest } from '../domain/types'
import { createLocalProfile } from '../domain/progress'
import { addMissingStoryChapters } from '../data/storyChapters'
import { storyHandovers, storyNeeds, storyUseQuestId } from './storyItemNeeds'

const ids = (chapter: string) => storyHandovers(chapter).map(({ stage, item }) => `${stage}:${item.id}×${item.count ?? 1}`)

describe('«Показать только сюжетные» (owner, 17.11.2026): what the story chapters have you hand over', () => {
  it('takes the hand-overs of every route, without money and optional ones', () => {
    // «Небеса в огне»: the G-Wagon flash drive, the batteries, boards, toolsets, the transcript, Elektronik's drive, the case;
    // not the optional 2 000 dollars.
    expect(ids('falling-skies')).toEqual([
      '5:67bde1dc5678472f2a0e6167×1', '10:590a358486f77429692b2790×3', '11:590a3b0486f7743954552bdb×5', '12:590c2e1186f77425357b6124×2',
      '14:689b4d39987b304021088e8d×1', '15:67bde548cf0cc29475092192×1', '18:68dfc07da7cfeed3e60204e7×1',
    ])
    // «Тур»: only money, so nothing.
    expect(ids('tour')).toEqual([])
  })

  it('leaves out what one route only asks for; an item every route of a stage asks for counts once', () => {
    // «Билет»: every hand-over belongs to one route or another (Kerman's offer, the kept case…).
    expect(ids('the-ticket')).toEqual([])
    const boreas = ids('boreas')
    // AMG-10 at stage 8 is asked for on all three routes: once. The military power filters of one route are not.
    expect(boreas.filter((entry) => entry.startsWith('8:'))).toEqual(['8:699f09de81a6c812900a77b7×1'])
    expect(boreas.some((entry) => entry.includes('5d0378d486f77420421a5ff4'))).toBe(false)
  })

  it('a stage behind the chapter\'s current one is handed over: its items move to «Собрано»', () => {
    const quests = addMissingStoryChapters([] as Quest[])
    const chapter = quests.find((quest) => quest.normalizedName === 'falling-skies' || quest.id.endsWith('falling-skies'))!
    expect(chapter).toBeTruthy()
    const base = createLocalProfile('t', 'story-needs').modes.pvp
    const at = (stage: number): ModeProgress => ({ ...base, taskProgress: { [chapter.id]: { taskId: chapter.id, status: 'active', source: 'manual', updatedAt: '2026-11-17T00:00:00.000Z', currentStageIndex: stage } } })
    const none = new Map<string, number>()

    const start = storyNeeds(quests, at(0), none, new Map())
    const batteries = start.items.find((need) => need.itemId === '590a358486f77429692b2790')!
    expect([batteries.total, batteries.remaining, batteries.foundInRaid]).toEqual([3, 3, true])
    // a quest item has a name of its own
    expect(start.questItems.find((item) => item.id === '67bde1dc5678472f2a0e6167')?.name).toBe('Флешка из внедорожника Gelandewagen')
    expect(storyUseQuestId(batteries.uses[0]!.stationId)).toBe(chapter.id)

    const later = storyNeeds(quests, at(11), none, new Map())
    expect(later.items.find((need) => need.itemId === '590a358486f77429692b2790')!.remaining).toBe(0)
    expect(later.items.find((need) => need.itemId === '590a3b0486f7743954552bdb')!.remaining).toBe(5)
    // the marks of found pieces count, as on the quests' page
    const marked = storyNeeds(quests, at(0), new Map([['590c2e1186f77425357b6124', 1]]), new Map())
    expect(marked.items.find((need) => need.itemId === '590c2e1186f77425357b6124')!.remaining).toBe(1)
  })
})
