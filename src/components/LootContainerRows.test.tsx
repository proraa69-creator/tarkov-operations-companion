import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOOT_CONTAINER_PICTURES } from '../assets/containerMarkers'
import { LOOT_CONTAINER_KINDS, lootContainerKindOf, lootContainerKindOfId, lootContainerTitle } from '../data/lootContainerKinds'
import type { MapMarker } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { LootContainerRows } from './LootContainerRows'

const SAFE = '578f8782245977354405a1e3'
const BANK_SAFE = '66acff0a1d8e1083b303f5af'
const JACKET = '578f8778245977358849a9b5'
const BAG = '578f87a3245977356274f2cb'
const point = (meta: string, id = meta) => ({ id, meta }) as unknown as MapMarker
const markers = [point(SAFE, 's1'), point(BANK_SAFE, 's2'), point(JACKET, 'j1'), point(JACKET, 'j2'), point(JACKET, 'j3'), point(BAG, 'b1')]
const rows = () => [...document.querySelectorAll('.layer-button.is-kind')].map((row) => `${row.querySelector('span')!.textContent} ${row.querySelector('small')!.textContent}${row.classList.contains('active') ? ' on' : ''}`)
const show = (props: { layerVisible: boolean; hidden?: string[] }) => {
  const onChange = vi.fn()
  render(<LocaleProvider><LootContainerRows markers={markers} layerVisible={props.layerVisible} hidden={props.hidden ?? []} onChange={onChange} /></LocaleProvider>)
  return onChange
}

afterEach(() => { cleanup(); localStorage.clear() })

// Owner, 06.11.2026: «сделай маркеры сейфа куртки и тд, как в игре… без кругов и фона, просто картинка».
describe('loot containers by kind', () => {
  it('every kind has a name and its own picture, and models of one thing are one kind', () => {
    for (const { kind, ru, en } of LOOT_CONTAINER_KINDS) {
      expect(ru && en).toBeTruthy()
      expect(LOOT_CONTAINER_PICTURES[kind]).toBeTruthy()
    }
    expect(lootContainerKindOfId(BANK_SAFE)).toBe('safe')
    expect(lootContainerKindOf({ meta: '5909d7cf86f77470ee57d75a' })).toBe('weapon-box')
    expect(lootContainerKindOf({ meta: 'unknown' })).toBeUndefined()
    expect(lootContainerKindOf({})).toBeUndefined()
  })

  it('a point is named after its kind; an id not known stays a plain container', () => {
    expect(lootContainerTitle(JACKET)).toBe('Куртка')
    expect(lootContainerTitle(BANK_SAFE)).toBe('Сейф')
    expect(lootContainerTitle('something-new')).toBeUndefined()
  })

  it('lists what this map has, in order, with how many of each', () => {
    show({ layerVisible: true })
    expect(rows()).toEqual(['Сейф 2 on', 'Куртка 3 on', 'Спортивная сумка 1 on'])
  })

  it('in English too', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    show({ layerVisible: true })
    expect(rows()).toEqual(['Safe 2 on', 'Jacket 3 on', 'Duffle bag 1 on'])
  })

  it('with the layer off every row is off, and a click shows that kind alone', () => {
    const onChange = show({ layerVisible: false })
    expect(rows()).toEqual(['Сейф 2', 'Куртка 3', 'Спортивная сумка 1'])
    fireEvent.click(screen.getByRole('button', { name: /Сейф/ }))
    const [hidden, layerVisible] = onChange.mock.calls[0]!
    expect(layerVisible).toBe(true)
    expect(hidden).toContain('jacket')
    expect(hidden).not.toContain('safe')
  })

  it('with the layer on a click turns one kind off and on again', () => {
    const off = show({ layerVisible: true })
    fireEvent.click(screen.getByRole('button', { name: /Куртка/ }))
    expect(off).toHaveBeenCalledWith(['jacket'], true)
    cleanup()
    const on = show({ layerVisible: true, hidden: ['jacket'] })
    expect(rows()[1]).toBe('Куртка 3')
    fireEvent.click(screen.getByRole('button', { name: /Куртка/ }))
    expect(on).toHaveBeenCalledWith([], true)
  })

  it('turning the last kind off turns the layer off', () => {
    const onChange = show({ layerVisible: true, hidden: ['jacket', 'duffle-bag'] })
    fireEvent.click(screen.getByRole('button', { name: /Сейф/ }))
    expect(onChange).toHaveBeenCalledWith([], false)
  })
})

// Owner, 06.11.2026: «на [настройки] сверху кнопку убери, а в ней же сделай новости».
describe('the top bar', () => {
  it('has the news where «Настройки» stood; settings stay in the left menu', () => {
    const shell = readFileSync(resolve(process.cwd(), 'src/app/AppShell.tsx'), 'utf8').replaceAll('\r\n', '\n')
    const desktop = shell.slice(shell.indexOf('<header className="topbar">'))
    const bar = desktop.slice(0, desktop.indexOf('</header>'))
    expect(bar).not.toContain("navigate('/settings')")
    expect(bar.indexOf('<NewsButton />')).toBeGreaterThan(bar.indexOf('<ServerQuickButton />'))
    expect(shell).toMatch(/to: '\/settings'|to="\/settings"/)
  })
})

// Owner, 06.11.2026: «верни кнопку «Поменять ник». Там рядом где-нибудь».
describe('«Поменять ник»', () => {
  it('stands in «Текущий профиль» beside «Вайп / Престиж» and «Сброс»', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/ProfilePage.tsx'), 'utf8')
    expect(page).toContain('<ModeResetButtons /><NicknameEditor />')
    expect(readFileSync(resolve(process.cwd(), 'src/account/NicknameEditor.tsx'), 'utf8')).toContain("uiLabel('Поменять ник')")
  })
})
