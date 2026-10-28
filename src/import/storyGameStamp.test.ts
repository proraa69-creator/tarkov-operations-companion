import { describe, expect, it } from 'vitest'
import { addMissingStoryChapters } from '../data/storyChapters'
import { matchStoryChapters, storyPaneChapter } from './storyScan'
import { storyPaneRects, storyPaneText, withoutGameStamp } from './storyPaneLayout'

const STORY = addMissingStoryChapters([], 'ru').filter((quest) => quest.kind === 'story')

// The game's stamp under the Tasks screen: version, server, mode (owner, 28.10.2026: «нашёл название сервера снизу.
// G4X0HW. Полоска PvP S…»).
const STAMPS = ['1.2.5.0.48146 | LOCAL | PvE', '1.2.5.0.48146 | G4X0HW | PvP S', 'G4X0HW | PvP Season']

describe('the game\'s stamp at the bottom of the screen is never read into a chapter', () => {
  it('drops the stamp lines and keeps the objectives', () => {
    for (const stamp of STAMPS) {
      expect(withoutGameStamp(`Главные задачи\nРасспросить торговцев об упавшем самолёте\n${stamp}`)).toBe('Главные задачи\nРасспросить торговцев об упавшем самолёте')
    }
    expect(withoutGameStamp('Достичь 2-го уровня лояльности у Прапора')).toBe('Достичь 2-го уровня лояльности у Прапора')
  })

  it('stops the objectives part above the stamp', () => {
    const size = { width: 3840, height: 2160 }
    const words = [
      { text: 'ИСТОРИЯ', bbox: { x0: 300, y0: 250, x1: 560, y1: 300 } },
      { text: 'Главные', bbox: { x0: 300, y0: 700, x1: 520, y1: 740 } },
      { text: '1.2.5.0.48146', bbox: { x0: 1700, y0: 1880, x1: 1950, y1: 1910 } },
    ]
    const rects = storyPaneRects(size, words)!
    expect(rects.body.y + rects.body.height).toBeLessThan(1880)
  })

  it('reads «Небеса в огне» with the stamp in its body and without the stamp as an objective', () => {
    const pane = { title: 'ИСТОРИЯ\nНЕБЕСА В ОГНЕ', status: 'АКТИВНО', body: 'Главные задачи\nРасспросить торговцев об упавшем самолёте\n1.2.5.0.48146 | G4X0HW | PvP S' }
    expect(storyPaneText(pane)).not.toContain('G4X0HW')
    const [own] = matchStoryChapters('', STORY, pane)
    expect(own).toMatchObject({ questId: 'story-falling-skies', active: true })
    expect(JSON.stringify(own?.objectives ?? [])).not.toMatch(/G4X0HW|PvP|48146/)
  })

  it('finds a long chapter name the banner wrapped over two lines', () => {
    expect(storyPaneChapter('ИСТОРИЯ\nНЕБЕСА В\nОГНЕ\nАКТИВНО', STORY)).toMatchObject({ quest: { id: 'story-falling-skies' }, active: true })
    expect(storyPaneChapter('ИСТОРИЯ\nСЛУЧАЙНЫЙ\nСВИДЕТЕЛЬ\nАКТИВНО', STORY)).toMatchObject({ quest: { id: 'story-accidental-witness' }, active: true })
  })
})
