import { describe, expect, it } from 'vitest'
import { repeatsTitle } from './repeatsTitle'

describe('a line that only repeats the point\'s title (owner, 08.11.2026)', () => {
  it('drops the key\'s own name and «Открывает …» of the same room', () => {
    const title = 'Ключ от помещения с телами'
    expect(repeatsTitle('Ключ от помещения с телами', title)).toBe(true)
    expect(repeatsTitle('Открывает помещение с телами.', title)).toBe(true)
    expect(repeatsTitle('Opens the room with bodies', 'Key to the room with bodies')).toBe(true)
  })

  it('keeps a line with anything of its own', () => {
    const title = 'Ключ от помещения с телами'
    expect(repeatsTitle('Трупы', title)).toBe(false)
    expect(repeatsTitle('Открывает помещение с телами. Также необходимо питание.', title)).toBe(false)
    expect(repeatsTitle('Основной этаж', 'Выход у моста')).toBe(false)
    expect(repeatsTitle('', title)).toBe(false)
    expect(repeatsTitle('Что-то', undefined)).toBe(false)
  })
})
