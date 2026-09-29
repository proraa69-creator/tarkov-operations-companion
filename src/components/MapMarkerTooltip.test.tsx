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

  it('has English for the new texts', () => {
    setRenderLanguage('en')
    expect(uiText(possibleSpotText({ kind: 'item', index: 2, count: 3 }))).toBe('Possible item location · 2 of 3')
    expect(uiText(possibleSpotText({ kind: 'zone', index: 1, count: 2 }))).toBe('Possible objective point · 1 of 2')
    expect(uiText('Дверь · открывает: TerraGroup Labs keycard (Red)')).toBe('Door · opened by: TerraGroup Labs keycard (Red)')
    expect(uiText('Нужна ключ-карта «TerraGroup Labs keycard (Red)».')).toBe('Requires keycard “TerraGroup Labs keycard (Red)”.')
    expect(uiText('Ключ-карта: фиолетовая')).toBe('Keycard: violet')
  })
})
