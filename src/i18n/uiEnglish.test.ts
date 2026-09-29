import { describe, expect, it } from 'vitest'
import { translateUiText } from './uiEnglish'

describe('English UI translation', () => {
  it('translates complete interface phrases and dynamic counters', () => {
    expect(translateUiText('Следующий рейд начинается здесь')).toBe('Your next raid starts here')
    expect(translateUiText('3 задания')).toBe('3 tasks')
    expect(translateUiText('Прапор · ур. 12 · Любая карта')).toBe('Прапор · lvl. 12 · Any map')
  })
})

describe('English for texts built by the app', () => {
  it('translates marker templates with variable parts', () => {
    expect(translateUiText('Возможная зона появления: Dormitory.')).toBe('Possible spawn zone: Dormitory.')
    expect(translateUiText('Переход на карту Woods')).toBe('Transit to Woods')
    expect(translateUiText('Нужен ключ «Dorm room 314 marked key».')).toBe('Requires key “Dorm room 314 marked key”.')
    expect(translateUiText('12 000 опыта')).toBe('12 000 XP')
  })
})

describe('story chapter stages', () => {
  it('translates the generated survive stage', () => {
    expect(translateUiText('Выжить на локации Развязка и выйти или посетить Развязку 3 раза')).toBe('Survive and extract from Interchange or visit Interchange 3 times')
  })
})

describe('whole interface phrases', () => {
  it('translates a sentence with commas as one phrase instead of splitting it', async () => {
    const { setRenderLanguage, uiText } = await import('./renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Клавиши, нажатые в игре')).toBe('Keys pressed in the game')
      expect(uiText('Наведите курсор на предмет, дождитесь подсказки с названием и нажмите клавишу: цена на барахолке, лучшая цена торговца и нужен ли предмет для заданий и «Коллекционера».'))
        .toBe('Hover an item, wait for its name tooltip and press the key: flea price, best trader price and whether the item is needed for tasks and Collector.')
      expect(uiText('с координатами · 5 с назад')).toBe('with coordinates · 5 s ago')
      expect(uiText('на переднем плане 5 с назад')).toBe('in front 5 s ago')
    } finally {
      setRenderLanguage('ru')
    }
  })
})
