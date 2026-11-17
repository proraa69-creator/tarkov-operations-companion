import { beforeEach, describe, expect, it } from 'vitest'
import { allMarkerLayers, defaultHiddenMarkerLayers } from '../domain/mapLayers'
import { everythingHidden, everythingShown, hideAll, keepLayersBefore, readLayersBefore, sameChoice, showAll, type LayerChoice, type ListedRows } from './layersAll'

const own: LayerChoice = { hiddenMarkers: [...defaultHiddenMarkerLayers], hiddenKinds: ['safe'], hiddenRooms: ['signs'], killZones: true, neededKeys: true }
const listed: ListedRows = { markers: ['extract.pmc', 'loot.container', 'boss'], rooms: ['signs', 'places'], killZones: true, neededKeys: true }

describe('report 181: «Показать все» / «Скрыть все» of «Точки на карте»', () => {
  beforeEach(() => localStorage.clear())

  it('«Показать все» turns on every row, the containers\' kinds and «Места устранения»', () => {
    const next = showAll(own)
    expect(next.hiddenMarkers).toEqual([])
    expect(next.hiddenKinds).toEqual([])
    expect(next.hiddenRooms).toEqual([])
    expect(next.killZones).toBe(true)
    expect(everythingShown(listed, next)).toBe(true)
    expect(everythingHidden(listed, next)).toBe(false)
  })

  it('«Скрыть все» turns off every layer on every map, «Нужные ключи» too, and keeps the kinds for later', () => {
    const next = hideAll(own)
    expect([...next.hiddenMarkers].sort()).toEqual([...allMarkerLayers].sort())
    expect(next.hiddenKinds).toEqual(['safe'])
    expect(next.killZones).toBe(false)
    expect(next.neededKeys).toBe(false)
    expect(everythingHidden(listed, next)).toBe(true)
    expect(everythingShown(listed, next)).toBe(false)
  })

  it('a hidden kind of container means not everything is shown; rows the map does not list do not count', () => {
    expect(everythingShown(listed, { ...showAll(own), hiddenKinds: ['safe'] })).toBe(false)
    expect(everythingShown({ ...listed, markers: ['extract.pmc'] }, { ...showAll(own), hiddenKinds: ['safe'] })).toBe(true)
    expect(everythingShown({ ...listed, killZones: false }, { ...showAll(own), killZones: false })).toBe(true)
  })

  it('the choice from before is kept for «Вернуть» and read back as it was', () => {
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
