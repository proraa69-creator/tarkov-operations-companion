import { describe, expect, it } from 'vitest'
import { STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'
import { decisionAtStage, decisionsFor, ENDINGS, STORY_DECISIONS, storyChapterId } from './storyEndings'

const chapter = (id: string, name: string, normalizedName?: string) => ({ id, name, normalizedName, kind: 'story' as const, trader: 'Глава истории' })

describe('«Концовки»: the four endings from the owner\'s flowchart (12.10.2026)', () => {
  it('has the four endings, each with its road, the way out and what to do when the attempt fails', () => {
    expect(ENDINGS.map((ending) => ending.name.ru)).toEqual(['Выживший', 'Спаситель', 'Падший', 'Должник'])
    for (const ending of ENDINGS) {
      expect(ending.steps.length).toBeGreaterThan(3)
      expect(ending.escape.ru).toMatch(/Терминал/)
      expect(ending.retry.ru).toMatch(/провалена/)
      for (const step of ending.steps) expect(step.text.en).toBeTruthy()
    }
    // the case decides Prapor's price in «Выживший»
    const survivor = ENDINGS[0].steps.filter((step) => step.when)
    expect(survivor.some((step) => step.text.ru.includes('300кк') && step.when?.ru.includes('отдан'))).toBe(true)
    expect(survivor.some((step) => step.text.ru.includes('500кк') && step.when?.ru.includes('оставлен'))).toBe(true)
  })

  it('finds the deciding choices of a chapter by its id or its name, and of the BTR Driver\'s tasks', () => {
    expect(storyChapterId(chapter('story-falling-skies', 'x'))).toBe('falling-skies')
    expect(storyChapterId(chapter('wiki-1', 'Небеса в огне'))).toBe('falling-skies')
    expect(storyChapterId(chapter('wiki-2', 'Билет', 'the-ticket'))).toBe('the-ticket')
    expect(decisionsFor(chapter('story-falling-skies', 'Небеса в огне')).map((decision) => decision.id)).toEqual(['armored-case'])
    expect(decisionsFor(chapter('story-the-ticket', 'Билет')).map((decision) => decision.id)).toEqual(['kerman-offer', 'kerman-evidence', 'prapor-72h'])
    expect(decisionsFor(chapter('story-tour', 'Тур'))).toEqual([])
    expect(decisionsFor({ id: 'q', name: 'Новый маршрут', trader: 'Водитель БТР' }).map((decision) => decision.id)).toEqual(['btr-driver'])
    expect(decisionsFor({ id: 'q', name: 'Дебют', trader: 'Прапор' })).toEqual([])
  })

  it('tells at the very stage where a choice leads; every such stage is a real stage of the chapter', () => {
    expect(decisionAtStage('Передать бронированный кейс Прапору')?.option?.choice.ru).toBe('Отдать кейс Прапору')
    expect(decisionAtStage('оставить бронированный кейс себе')?.option?.choice.ru).toBe('Оставить кейс себе')
    expect(decisionAtStage('Отказаться от предложения мистера Кермана о сотрудничестве')?.option?.endings).toEqual(['survivor'])
    expect(decisionAtStage('Предать мистера Кермана и оставить улики себе')?.option?.endings).toEqual(['debtor'])
    // a deadline: the whole decision (both outcomes), not one option
    const deadline = decisionAtStage('Вовремя выполнить все задания Прапора')
    expect(deadline?.decision.id).toBe('prapor-72h')
    expect(deadline?.option).toBeUndefined()
    expect(decisionAtStage('Поговорить с Прапором')).toBeUndefined()
    const stages = new Set(STORY_CHAPTER_SEEDS.flatMap((seed) => seed.stages.map((stage) => stage.ru)))
    for (const decision of STORY_DECISIONS) {
      for (const stage of [...(decision.stages ?? []), ...decision.options.flatMap((option) => option.stage ?? [])]) expect(stages).toContain(stage)
      for (const id of decision.chapters) expect(STORY_CHAPTER_SEEDS.map((seed) => seed.id)).toContain(id)
    }
  })
})
