import { beforeEach, describe, expect, it } from 'vitest'
import { allMarkerLayers, defaultHiddenMarkerLayers } from '../domain/mapLayers'
import { everythingHidden, hideAll, keepLayersBefore, readLayersBefore, sameChoice, shownAgain, type LayerChoice, type ListedRows } from './layersAll'

const own: LayerChoice = { hiddenMarkers: [...defaultHiddenMarkerLayers], hiddenKinds: ['safe'], hiddenRooms: ['signs'], killZones: true, neededKeys: true }
const listed: ListedRows = { markers: ['extract.pmc', 'loot.container', 'boss'], rooms: ['signs', 'places'], killZones: true, neededKeys: true }

describe('report 181: «Показать все» / «Скрыть все» of «Точки на карте»', () => {
  beforeEach(() => localStorage.clear())

  it('«Показать все» brings back the player’s own choice, not every layer; a row turned on by hand since stays on', () => {
    const hidden = hideAll(own)
    expect(sameChoice(shownAgain(own, hidden), own)).toBe(true)
    const byHand = { ...hidden, hiddenMarkers: hidden.hiddenMarkers.filter((id) => id !== 'boss') }
    const back = shownAgain(own, byHand)
    expect(back.hiddenMarkers).toEqual(own.hiddenMarkers.filter((id) => id !== 'boss'))
    expect(back.hiddenKinds).toEqual(['safe'])
    expect(back.hiddenRooms).toEqual(['signs'])
    expect(everythingHidden(listed, back)).toBe(false)
  })

  it('«Скрыть все» turns off every layer on every map, «Нужные ключи» too, and keeps the kinds for later', () => {
    const next = hideAll(own)
    expect([...next.hiddenMarkers].sort()).toEqual([...allMarkerLayers].sort())
    expect(next.hiddenKinds).toEqual(['safe'])
    expect(next.killZones).toBe(false)
    expect(next.neededKeys).toBe(false)
    expect(everythingHidden(listed, next)).toBe(true)
  })

  it('the choice «Скрыть все» keeps is read back as it was (after a restart too)', () => {
    expect(readLayersBefore()).toBeNull()
    keepLayersBefore(own)
    const back = readLayersBefore()
    expect(back && sameChoice(back, own)).toBe(true)
    keepLayersBefore(null)
    expect(readLayersBefore()).toBeNull()
  })

  it('a damaged or foreign saved value does not break the map', () => {
    localStorage.setItem('raidos-map-layers-before-all-v1', '{"hiddenMarkers":["nope","boss"],"hiddenRooms":[1,"fire"]}')
    expect(readLayersBefore()).toEqual({ hiddenMarkers: ['boss'], hiddenKinds: [], hiddenRooms: ['fire'], killZones: true, neededKeys: false })
    localStorage.setItem('raidos-map-layers-before-all-v1', '{oops')
    expect(readLayersBefore()).toBeNull()
  })
})
