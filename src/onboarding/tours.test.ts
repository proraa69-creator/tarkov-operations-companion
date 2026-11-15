import { describe, expect, it } from 'vitest'
import { dueTips, SECTIONS, type ToursRecord } from './tours'

/** Owner, 15.11.2026: the first-visit tips of «Квесты» and «Карты» say what the app does now. */
const step = (section: string, id: string) => SECTIONS.find((entry) => entry.id === section)?.steps.find((entry) => entry.id === id)

describe('first-visit tips', () => {
  it('story quests are set by hand, on every device', () => {
    const story = step('quests', 'story')!
    expect(story.when).toBeUndefined()
    expect(story.tip.text(false)).toEqual({
      ru: 'Выберите свои текущие сюжетные задания и переключите каждое на этап, на котором вы сейчас в игре.',
      en: 'Pick your current story quests and set each one to the stage you are at in the game.',
    })
  })

  it('the checkmark does not complete the quest', () => {
    expect(step('maps', 'checkmark')!.tip.text(false).ru).toBe('Галочка не отмечает задание выполненным. Она для удобства: точки задания уходят с карты и не мешают.')
  })

  it('the map has no «Ваша точка на карте» tip', () => {
    expect(step('maps', 'position')).toBeUndefined()
    expect(SECTIONS.find((entry) => entry.id === 'maps')!.steps.map((entry) => entry.id)).toEqual(['checkmark', 'view'])
  })
})

describe('tips added in a later release', () => {
  const context = { phone: false, desktop: true }
  const record = (app?: string): ToursRecord => ({ choice: 'yes', since: '0', seen: [], ...(app ? { app } : {}) })
  const builds = (entry: ToursRecord) => dueTips('/arsenal/builds', entry, context).map((tip) => tip.key)

  it('come to a device that started with that release or later', () => {
    expect(builds(record('0.6.0.308'))).toEqual(['weapon-builds:level'])
    expect(builds(record('0.6.0.312'))).toEqual(['weapon-builds:level'])
    expect(dueTips('/arsenal/builds', record('0.6.0.308'), context)[0]!.tip.text(false).ru).toBe('Сборки собираются из того, что вам доступно: по уровню персонажа, уровням торговцев и барахолке. Чем выше уровень, тем лучше сборки.')
  })

  it('never come after an update to a device that started before', () => {
    expect(builds(record('0.6.0.307'))).toEqual([])
    expect(builds(record())).toEqual([])
    // the tips it had from the start still come on a section's first visit
    expect(dueTips('/quests', record('0.6.0.300'), context).map((tip) => tip.key)).toEqual(['quests:story'])
  })

  it('a seen tip never comes again', () => {
    expect(builds({ ...record('0.6.0.308'), seen: ['weapon-builds:level'] })).toEqual([])
  })
})
