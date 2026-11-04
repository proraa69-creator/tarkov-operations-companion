import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapMarkerTooltip } from './MapMarkerTooltip'
import { possibleSpotText } from '../data/mapMarkerAdapter'
import { setRenderLanguage, uiText } from '../i18n/renderText'
import type { MapMarker } from '../domain/types'

const base: MapMarker = { id: 'm', mapId: 'ground-zero', type: 'quest', layerId: 'quest.zone', title: 'Спасти крота', description: 'Найти жёсткий диск', position: [0, 0] }

afterEach(() => setRenderLanguage('ru'))

describe('MapMarkerTooltip', () => {
  it('marks one of several item spawns as «Возможное место предмета» under the quest name', () => {
    render(<MapMarkerTooltip marker={{ ...base, possibleSpot: { kind: 'item', index: 2, count: 3 } }} typeLabel="Квест" color="#d5b76f" floor="Основной" />)
    expect(screen.getByText('Спасти крота')).toBeTruthy()
    expect(screen.getByText('Возможное место предмета · 2 из 3')).toBeTruthy()
  })

  it('shows the keycard colour of a Labs door', () => {
    render(<MapMarkerTooltip marker={{ ...base, type: 'key', layerId: 'key', title: 'Дверь · открывает: Ключ-карта TerraGroup Labs (Красная)', description: '', lock: { keyName: 'Ключ-карта TerraGroup Labs (Красная)', keycard: 'red' } }} typeLabel="Ключ" color="#8ea8c4" floor="2 уровень" />)
    expect(screen.getByText('Ключ-карта: красная')).toBeTruthy()
    expect(screen.getByText('Дверь · открывает: Ключ-карта TerraGroup Labs (Красная)')).toBeTruthy()
  })

  // Owner, 04.11.2026, a player's report on «Лифт в стилобате»: «добавь всю информацию и этаж … только показывай описание и этаж».
  const lift: MapMarker = { ...base, id: 'streets-of-tarkov-extract-321358e7c712157a0692f8212c0ce644a85d8d9a', mapId: 'streets-of-tarkov', type: 'extract', layerId: 'extract.pmc', title: 'Лифт в стилобате', description: 'Выход ЧВК.', meta: 'Выход ЧВК', floor: '2 этаж' }

  it('an exit shows its place, its real floor and a photo instead of the catalog\'s generic words', () => {
    const { container } = render(<MapMarkerTooltip marker={lift} typeLabel="Выходы ЧВК" color="#d5b76f" floor="2 этаж" />)
    expect(screen.getByText(/За барной стойкой на 3-м этаже ресторана «Белуга», проход через кухню/)).toBeTruthy()
    expect(screen.getByText('3 этаж')).toBeTruthy()
    expect(screen.queryByText('2 этаж')).toBeNull()
    expect(screen.queryByText('Выход ЧВК.')).toBeNull()
    expect(container.querySelector('img.mmt-shot')?.getAttribute('src')).toMatch(/^https:\/\/raidos\.app\/v1\/guide-images\/wiki-[0-9a-f]{16}-t\.png$/)
  })

  it('an exit not in the list keeps what the catalog says', () => {
    render(<MapMarkerTooltip marker={{ ...lift, id: 'not-listed', extractId: undefined }} typeLabel="Выходы ЧВК" color="#d5b76f" floor="2 этаж" />)
    expect(screen.getByText('Выход ЧВК.')).toBeTruthy()
    expect(screen.getByText('2 этаж')).toBeTruthy()
  })

  it('has English for the new texts', () => {
    setRenderLanguage('en')
    expect(uiText(possibleSpotText({ kind: 'item', index: 2, count: 3 }))).toBe('Possible item location · 2 of 3')
    expect(uiText(possibleSpotText({ kind: 'zone', index: 1, count: 2 }))).toBe('Possible objective point · 1 of 2')
    expect(uiText('Дверь · открывает: TerraGroup Labs keycard (Red)')).toBe('Door · opened by: TerraGroup Labs keycard (Red)')
    expect(uiText('Нужна ключ-карта «TerraGroup Labs keycard (Red)».')).toBe('Requires keycard “TerraGroup Labs keycard (Red)”.')
    expect(uiText('Ключ-карта: фиолетовая')).toBe('Keycard: violet')
  })

  it('shows «Спавн 100 %» only for a marker the data marks as certain (RU and EN)', () => {
    const { unmount } = render(<MapMarkerTooltip marker={{ ...base, layerId: 'quest.item', guaranteedSpawn: true }} typeLabel="Квест" color="#d5b76f" floor="Основной" />)
    expect(screen.getByText('Спавн 100 %')).toBeTruthy()
    unmount()
    render(<MapMarkerTooltip marker={base} typeLabel="Квест" color="#d5b76f" floor="Основной" />)
    expect(screen.queryByText('Спавн 100 %')).toBeNull()
    setRenderLanguage('en')
    expect(uiText('Спавн 100 %')).toBe('Spawn 100 %')
  })

  it('a boss with a certain spawn says «Спавн 100 %» instead of the chance; others keep their chance', () => {
    const boss = { key: 'killa', name: 'Килла', spawnChance: 1 }
    const marker: MapMarker = { ...base, type: 'boss', layerId: 'boss', title: 'Килла', description: '', boss }
    const { unmount } = render(<MapMarkerTooltip marker={{ ...marker, guaranteedSpawn: true }} typeLabel="Босс" color="#d64838" floor="Основной" boss={boss} />)
    expect(screen.getByText('Спавн 100 %')).toBeTruthy()
    unmount()
    render(<MapMarkerTooltip marker={marker} typeLabel="Босс" color="#d64838" floor="Основной" boss={{ ...boss, spawnChance: 0.35 }} />)
    expect(screen.getByText('шанс 35%')).toBeTruthy()
    expect(screen.queryByText('Спавн 100 %')).toBeNull()
  })
})
