import { describe, expect, it } from 'vitest'
import { overlayEnglish } from './englishDataset'
import type { AppDataset, Quest } from '../domain/types'

const quest = (patch: Partial<Quest>): Quest => ({ id: 'q', name: 'Благодарность', trader: 'Барахольщик', level: 1, kappa: false, description: 'Длинный текст из русской вики про задание.', objectives: ['Найти предмет'], rewards: [], ...patch })
const dataset = (quests: Quest[]): AppDataset => ({ maps: [], markers: [], quests, items: [], hideout: [], traders: [] })

describe('overlayEnglish', () => {
  it('replaces untranslatable Russian descriptions with English objectives and links the English wiki', () => {
    const ru = dataset([quest({ wikiLink: 'https://escapefromtarkov.fandom.com/ru/wiki/X' })])
    const en = dataset([quest({ name: 'Gratitude', description: '', objectives: ['Hand over 3 Bottles of water'] })])
    const [result] = overlayEnglish(ru, en).quests
    expect(result).toMatchObject({ name: 'Gratitude', description: 'Hand over 3 Bottles of water', wikiLink: 'https://escapefromtarkov.fandom.com/wiki/Gratitude' })
  })

  it('keeps the game\'s Russian and English titles for the screen reader', () => {
    const ru = dataset([quest({})])
    const [result] = overlayEnglish(ru, dataset([quest({ name: 'Gratitude' })])).quests
    expect(result).toMatchObject({ name: 'Gratitude', nameRu: 'Благодарность', nameEn: 'Gratitude' })
  })

  it('takes the quest base\'s titles first: a story chapter keeps its Russian name in the English catalog', () => {
    const chapter = { id: 'story-falling-skies', name: 'Небеса в огне', kind: 'story' as const, nameRu: 'Небеса в огне', nameEn: 'Falling Skies', ocrAliases: ['Падающие небеса'] }
    const [result] = overlayEnglish(dataset([quest(chapter)]), dataset([quest(chapter)])).quests
    expect(result).toMatchObject({ nameRu: 'Небеса в огне', nameEn: 'Falling Skies', ocrAliases: ['Падающие небеса'] })
  })

  it('keeps counts and ids from the Russian catalog', () => {
    const ru = dataset([quest({ id: 'a' }), quest({ id: 'b' })])
    expect(overlayEnglish(ru, dataset([quest({ id: 'a', name: 'A' })])).quests.map((entry) => entry.id)).toEqual(['a', 'b'])
  })
})
