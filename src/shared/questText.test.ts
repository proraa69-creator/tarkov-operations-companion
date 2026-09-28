import { describe, expect, it } from 'vitest'
import { cleanQuestText } from './questText'

describe('quest text cleanup', () => {
  it('strips wiki links, templates and html', () => {
    expect(cleanQuestText("Найти '''[[Таможня|таможенный]]''' склад {{Icon|x}}<br/>на [[Развязка]]")).toBe('Найти таможенный склад на Развязка')
  })
  it('removes nested templates and file links', () => {
    expect(cleanQuestText('[[Файл:Map.png|200px]] Выжить {{nowrap|{{Tag|1}} раз}}')).toBe('Выжить раз')
  })
  it('repairs utf-8 text decoded as latin-1', () => {
    expect(cleanQuestText('Ð—Ð°Ð´Ð°Ð½Ð¸Ðµ')).toBe('Задание')
  })
  it('drops replacement and zero-width characters', () => {
    expect(cleanQuestText('Ус\u200Bтановить\uFFFD маяк &nbsp;&laquo;MS2000&raquo;')).toBe('Установить маяк «MS2000»')
  })
})
