import { describe, expect, it } from 'vitest'
import { carName, carNeedsText } from './carLocks'

describe('locked cars (owner, 23.11.2026)', () => {
  it('names the car a key opens: ours by the key, else the key without «Ключ от автомобиля»', () => {
    expect(carName('5913651986f774432f15d132', 'Ключ от автомобиля Жигули')).toBe('Жигули')
    expect(carName('68e63b56ad8cba49190ea529', 'Ключ от машины Почты Руси')).toBe('Почта Руси')
    expect(carName('other', 'Ключ от автомобиля Volga')).toBe('Volga')
    expect(carName(undefined, 'Ключ-брелок от автомобиля')).toBe('Ключ-брелок от автомобиля')
  })

  it('says which key: «Нужен ключ от автомобиля «Жигули».»', () => {
    expect(carNeedsText('Жигули')).toBe('Нужен ключ от автомобиля «Жигули».')
  })
})
