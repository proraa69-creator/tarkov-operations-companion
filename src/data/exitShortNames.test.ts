// @vitest-environment node
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain script, without types
import { EXIT_NOTES } from '../../scripts/extract-guide-notes.mjs'
import { exitShortName } from './exitShortNames'

/** Longer than this, a name no longer stands in two short lines under an icon. */
const LONGEST = 17

describe('the short names under the exits', () => {
  it('by the owner\'s examples', () => {
    expect(exitShortName('Старая заправка', 'ru')).toBe('Старая заправка')
    expect(exitShortName('Бункер Контрабандистов (ЗБ-1012)', 'ru')).toBe('ЗБ-1012')
    expect(exitShortName('ЗБ-1011', 'ru')).toBe('ЗБ-1011')
    expect(exitShortName("Smugglers' Bunker (ZB-1012)", 'en')).toBe('ZB-1012')
  })

  it('finds an exit by either language\'s name and shows the app\'s language', () => {
    expect(exitShortName('Ворота у медицинской палатки', 'en')).toBe('Med Tent')
    expect(exitShortName('Med Tent Gate', 'ru')).toBe('Мед. палатка')
    expect(exitShortName('  дорога на таможню ', 'ru')).toBe('На Таможню')
    expect(exitShortName('Boiler Room Basement (Совм.)', 'en')).toBe('Boiler Room')
  })

  it('every exit the app knows has a listed short name, short enough, in both languages', () => {
    const titles = Object.values(EXIT_NOTES as Record<string, object>).flatMap((notes) => Object.keys(notes))
    expect(titles.length).toBeGreaterThan(100)
    for (const title of titles) {
      for (const locale of ['ru', 'en'] as const) {
        const short = exitShortName(title, locale)
        expect(short.length, `${title} → ${short}`).toBeLessThanOrEqual(LONGEST)
        expect(short, title).not.toMatch(/[()]/)
      }
    }
  })

  it('a transit names only where it leads', () => {
    expect(exitShortName('Переход на карту Лес', 'ru')).toBe('→ Лес')
    expect(exitShortName('Переход на карту Лес', 'en')).toBe('→ Woods')
    expect(exitShortName('Transit to Woods', 'en')).toBe('→ Woods')
    expect(exitShortName('Переход на карту Улицы Таркова', 'ru')).toBe('→ Улицы')
    expect(exitShortName('Transit to Streets of Tarkov', 'en')).toBe('→ Streets')
    expect(exitShortName('Переход на Лабиринт?', 'ru')).toBe('→ Лабиринт')
    expect(exitShortName('Переход на Берег', 'en')).toBe('→ Shoreline')
  })

  it('a new exit, not listed yet, keeps its name without what stands in brackets', () => {
    expect(exitShortName('Новый выход (Сигнал)', 'ru')).toBe('Новый выход')
  })
})
