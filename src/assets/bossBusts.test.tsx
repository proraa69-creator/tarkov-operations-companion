import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { bossBust, bossBustFor } from './bossBusts'
import { MapMarkerTooltip } from '../components/MapMarkerTooltip'
import type { MapMarker } from '../domain/types'

const file = (url?: string) => url?.split('/').pop()?.replace(/\.png.*$/, '')
const marker = (boss: MapMarker['boss'], title = boss?.name ?? 'Босс'): MapMarker => ({ id: 'b', mapId: 'ground-zero', type: 'boss', layerId: 'boss', title, description: '', position: [0, 0], boss })

describe('bossBust', () => {
  it('finds the Black Division and Wedge busts by every key the feed and our data use', () => {
    expect(file(bossBust(marker({ key: 'black-division', name: 'Black Division' })))).toBe('black-div-boss')
    expect(file(bossBust(marker({ key: 'black-div', name: 'Black Div.' })))).toBe('black-div')
    expect(file(bossBust(marker({ key: 'black-div-boss', name: 'Black Div. Boss' })))).toBe('black-div-boss')
    expect(file(bossBust(marker({ key: 'the-wedge', name: 'The Wedge' })))).toBe('the-wedge')
    expect(file(bossBust(marker({ key: 'wadge', name: 'Wadge' })))).toBe('the-wedge')
    expect(file(bossBust(marker({ key: 'the-wedge-labs', name: 'The Wedge (Labs)' })))).toBe('the-wedge-labs')
  })

  it('falls back to the name (Russian «Клин» too) and skips the generic unknown-npc portrait', () => {
    expect(file(bossBustFor({ name: 'Клин' }))).toBe('the-wedge')
    expect(file(bossBustFor({ name: 'Black Division' }))).toBe('black-div-boss')
    expect(file(bossBustFor({ key: 'the-wedge', name: 'The Wedge', portraitUrl: 'https://assets.tarkov.dev/unknown-npc-portrait.webp' }))).toBe('the-wedge')
    expect(file(bossBustFor({ key: 'reshala', name: 'Решала', portraitUrl: 'https://assets.tarkov.dev/reshala-portrait.webp' }))).toBe('reshala')
    expect(bossBustFor({ key: 'nobody', name: 'Некто' })).toBeUndefined()
  })
})

describe('boss tooltip portrait', () => {
  it('shows the bust when tarkov.dev has no portrait (no empty square)', () => {
    const boss = { key: 'black-division', name: 'Black Division' }
    const { container } = render(<MapMarkerTooltip marker={marker(boss)} typeLabel="Босс" color="#d64838" floor="Основной" boss={boss} />)
    expect(container.querySelector('.mmt-portrait.is-empty')).toBeNull()
    expect(file(container.querySelector('img.mmt-portrait')?.getAttribute('src') ?? undefined)).toBe('black-div-boss')
  })

  it('switches to the bust when the tarkov.dev portrait fails to load', () => {
    const boss = { key: 'wadge', name: 'Клин', portraitUrl: 'https://assets.tarkov.dev/wadge-portrait.webp' }
    const { container } = render(<MapMarkerTooltip marker={marker(boss)} typeLabel="Босс" color="#d64838" floor="Основной" boss={boss} />)
    const img = container.querySelector('img.mmt-portrait')!
    expect(img.getAttribute('src')).toBe(boss.portraitUrl)
    fireEvent.error(img)
    expect(file(container.querySelector('img.mmt-portrait')?.getAttribute('src') ?? undefined)).toBe('the-wedge')
  })
})
