import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { BallisticsGuideButton } from './BallisticsGuide'
import { BALLISTICS_GUIDE_POINTS, BALLISTICS_GUIDE_TITLE, guidePointParts, guideTexts } from './ballisticsGuidePoints'
import { setRenderLanguage, uiLabel, uiText } from '../i18n/renderText'
import { loadTargetTable } from '../i18n/targetText'
import type { TargetLanguage } from '../i18n/languages'
import { effectiveResistance, penetrationChance } from './ballistics'
import { keptAfterPenetration, penetrationChancePercent } from '../range/rangeModel'

const TARGETS: TargetLanguage[] = ['de', 'es', 'fr', 'ja', 'ko', 'pl', 'pt', 'tr', 'zh']
const CYRILLIC = /[а-яё]/i

afterEach(() => setRenderLanguage('ru'))

const open = () => {
  render(<BallisticsGuideButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Как работает баллистика' }))
  return screen.getByRole('dialog', { name: 'Как работает баллистика' })
}
const pointsOf = (dialog: HTMLElement) => [...dialog.querySelectorAll<HTMLElement>('.ballistics-guide-list > li')]

describe('«Как работает баллистика» (owner, 28.11.2026)', () => {
  it('the button opens a window with the title and the eight points, each with its bold start', () => {
    const dialog = open()
    const points = pointsOf(dialog)
    expect(points).toHaveLength(8)
    expect(points.map((point) => point.querySelector('strong')?.textContent)).toEqual([
      'Урон', 'Броня', 'Пробьёт ли', 'Прочность', 'Если пробила', 'Если не пробила', 'Рикошет', 'Кровотечение и осколки',
    ])
    expect(points[0]!.textContent).toBe(BALLISTICS_GUIDE_POINTS[0]!.text)
    expect(within(dialog).getByText(/подмышки не защищены никакой бронёй/)).toBeInTheDocument()
  })

  it('«Пробьёт ли» in the owner\'s words: class × 10 explained, a list of three lines for class 4, then worn armour and the angle', () => {
    const point = pointsOf(open())[2]!
    expect(point.textContent).toContain('у брони есть класс защиты от 1 до 6 (виден при осмотре брони в игре), у патрона — число «Пробитие» (оно есть в «Списке патронов»). Умножьте класс брони на 10')
    expect([...point.querySelectorAll('.ballistics-guide-sublist > li')].map((item) => item.textContent)).toEqual([
      'пробитие 40 и больше — пробивает почти всегда (9 раз из 10 и чаще);',
      'от 26 до 39 — иногда: чем ближе к 40, тем чаще;',
      '25 и меньше — не пробьёт, пока броня целая.',
    ])
    expect(point.querySelector('.ballistics-guide-after')?.textContent).toBe('Поношенную броню пробить легче. Угол попадания значения не имеет.')
    // nothing of the old wording
    expect(point.textContent).not.toMatch(/Ориентир|целой брони 4 класса/)
    // the lines of the list have no bold start
    expect(point.querySelectorAll('strong')).toHaveLength(1)
  })

  it('closes by its cross, by Escape and by a click beside it', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Как работает баллистика' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Как работает баллистика' }))
    fireEvent.mouseDown(document.querySelector('.ballistics-guide-overlay')!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a click inside the window keeps it open', () => {
    const dialog = open()
    fireEvent.mouseDown(pointsOf(dialog)[2]!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('says what the app counts too (src/arsenal/ballistics.ts, src/range/rangeModel.ts)', () => {
    // class 4 armour, intact: 40 and more almost always (9 in 10 and more), 26–39 sometimes and more often nearer 40, 25 and less never
    expect(effectiveResistance(4)).toBeCloseTo(40, 0)
    expect(penetrationChance(effectiveResistance(4), 4)).toBeCloseTo(0.9, 5)
    expect(penetrationChance(40, 4)).toBeGreaterThan(0.85)
    expect(penetrationChancePercent(40, 40)).toBeCloseTo(90, 5)
    expect(penetrationChance(45, 4)).toBeGreaterThan(0.9)
    expect(penetrationChance(26, 4)).toBeGreaterThan(0)
    expect(penetrationChance(26, 4)).toBeLessThan(penetrationChance(33, 4))
    expect(penetrationChance(33, 4)).toBeLessThan(penetrationChance(39, 4))
    expect(penetrationChance(25, 4)).toBe(0)
    expect(penetrationChancePercent(40, 25)).toBe(0)
    // worn armour is easier to go through
    expect(penetrationChance(30, 4, 50)).toBeGreaterThan(penetrationChance(30, 4))
    // going through loses 0–40 % of the damage: about 20 % at about equal penetration
    expect(keptAfterPenetration(40, 60)).toBe(1)
    expect(keptAfterPenetration(60, 1)).toBe(0.6)
    expect(1 - keptAfterPenetration(40, 40)).toBeCloseTo(0.23, 2)
  })

  it('the bold start is the text before the first « — », else there is none', () => {
    expect(guidePointParts('Пробьёт ли — у брони. Умножьте — столько')).toEqual({ lead: 'Пробьёт ли', rest: 'у брони. Умножьте — столько' })
    expect(guidePointParts('Без тире')).toEqual({ lead: '', rest: 'Без тире' })
  })

  it('English: the owner\'s words, with the same bold starts; the tab and the number as the app names them', () => {
    setRenderLanguage('en')
    expect(uiLabel(BALLISTICS_GUIDE_TITLE)).toBe('How ballistics work')
    for (const text of guideTexts()) expect(uiText(text)).not.toMatch(CYRILLIC)
    expect(BALLISTICS_GUIDE_POINTS.map((point) => guidePointParts(uiText(point.text)).lead)).toEqual([
      'Damage', 'Armor', 'Will it penetrate', 'Durability', 'If it penetrates', 'If it doesn\'t', 'Ricochet', 'Bleeding and fragments',
    ])
    expect(uiText(BALLISTICS_GUIDE_POINTS[1]!.text)).toBe('Armor — doesn\'t reduce damage: it either stops the bullet completely or lets it through. It protects only its own zones (see the item\'s inspect view); the armpits are never covered.')
    const penetrate = BALLISTICS_GUIDE_POINTS[2]!
    expect(uiText(penetrate.text)).toContain(`a round has a «${uiLabel('Пробитие')}» number (see «${uiLabel('Список патронов')}»)`)
    expect(penetrate.items!.map((item) => uiText(item))).toEqual([
      'penetration 40 or more — almost always goes through (9 times in 10 or more);',
      '26 to 39 — sometimes: the closer to 40, the more often;',
      '25 or less — won\'t go through while the armor is intact.',
    ])
    expect(uiText(penetrate.after!)).toBe('Worn armor is easier to penetrate. The angle of impact doesn\'t matter.')
  })

  it('each of the nine other languages has every text of the window, each point with its bold start', async () => {
    setRenderLanguage('en')
    const title = uiLabel(BALLISTICS_GUIDE_TITLE)
    const leads = new Set(BALLISTICS_GUIDE_POINTS.map((point) => uiText(point.text)))
    const texts = guideTexts()
    const english = texts.map((text) => uiText(text))
    const tab = uiLabel('Список патронов')
    const number = uiLabel('Пробитие')
    setRenderLanguage('ru')
    for (const language of TARGETS) {
      const table = JSON.parse(readFileSync(resolve(process.cwd(), `src/i18n/locales/${language}.json`), 'utf8')) as Record<string, string>
      expect(table[title], language).toBeTruthy()
      for (const key of english) {
        const text = table[key]
        expect(text, `${language}: ${key}`).toBeTruthy()
        expect(text, language).not.toMatch(CYRILLIC)
        if (leads.has(key)) expect(guidePointParts(text!).lead, `${language}: ${key}`).not.toBe('')
      }
      // «Пробьёт ли» names the tab and the number as this language's app does
      const penetrate = table[uiTextEnglish(BALLISTICS_GUIDE_POINTS[2]!.text, english, texts)]!
      expect(penetrate, language).toContain(table[tab]!)
      expect(penetrate, language).toContain(table[number]!)
      await loadTargetTable(language)
      setRenderLanguage(language)
      expect(uiLabel(BALLISTICS_GUIDE_TITLE), language).toBe(table[title])
      texts.forEach((text, index) => expect(uiText(text), language).toBe(table[english[index]!]))
      setRenderLanguage('ru')
    }
  })

  it('the old folded «Как работает пробитие» is gone from the dictionary', () => {
    setRenderLanguage('en')
    expect(uiText('Как работает пробитие')).not.toBe('How penetration works')
  })
})

/** The English of one of the window's Russian texts, from the lists made above. */
function uiTextEnglish(russian: string, english: string[], texts: string[]) {
  return english[texts.indexOf(russian)]!
}
