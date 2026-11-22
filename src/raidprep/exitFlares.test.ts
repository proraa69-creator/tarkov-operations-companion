import { describe, expect, it } from 'vitest'
import type { MapMarker, QuestObjective } from '../domain/types'
import { exitFlareNeeds, flareCardOf, flareExitsOn, isFlare, isHandFlare, SIGNAL_PISTOL_ID, type QuestRaidLine } from './exitFlares'

const exit = (id: string, mapId: string, title: string, extra: Partial<MapMarker> = {}): MapMarker => ({
  id, mapId, title, type: 'extract', layerId: 'extract.pmc', extractFaction: 'pmc', extractId: id.replace(/^.*-extract-/, ''), description: '', position: [0, 0], ...extra,
})

const markers: MapMarker[] = [
  exit('customs-extract-rail', 'customs', 'Проход через ЖД пути (Сигнал)'),
  exit('customs-extract-gas', 'customs', 'Старая заправка'),
  exit('customs-extract-rail__scav', 'customs', 'Проход через ЖД пути (Сигнал)', { extractFaction: 'scav', layerId: 'extract.scav' }),
  exit('streets-of-tarkov-extract-klimov', 'streets-of-tarkov', 'Улица Климова (Сигнал)'),
  // Icebreaker's helicopter is called by a green flare: our exit guide says so, its name does not
  exit('icebreaker-extract-9bf65c4c24d0153f1542a90ddabadb37198ab9ff', 'icebreaker', 'Вертолет'),
  exit('factory-extract-gate', 'factory', 'Ворота 3'),
]

/** «Прекратить огонь!»: leave Streets through the flare exit; its green flare is the quest's own line. */
const ceasefire = (objectiveDetails: QuestObjective[] = [{ id: 'e1', type: 'extract', description: 'Выйти через ул. Климова', count: 1 }]) => ({ objectiveDetails })
const questFlare = (objectiveId = 'e1', quest = ceasefire()): QuestRaidLine => ({ purpose: 'signal', objectiveId, quest })

describe('the exits of a map opened by a flare', () => {
  it('every map with one, the Scavs\' twin not twice, the helicopter by our guide', () => {
    expect(flareExitsOn(markers, 'customs').map((marker) => marker.id)).toEqual(['customs-extract-rail'])
    expect(flareExitsOn(markers, 'streets-of-tarkov').map((marker) => marker.id)).toEqual(['streets-of-tarkov-extract-klimov'])
    expect(flareExitsOn(markers, 'icebreaker')).toHaveLength(1)
    expect(flareExitsOn(markers, 'factory')).toEqual([])
  })
})

describe('«Требования рейда»: the flare an exit needs', () => {
  it('no quest: the exit has its line', () => {
    expect(exitFlareNeeds(markers, 'streets-of-tarkov', []).map((marker) => marker.id)).toEqual(['streets-of-tarkov-extract-klimov'])
  })

  it('«Прекратить огонь!» current: no extra line, the quest\'s flare is the exit\'s', () => {
    expect(exitFlareNeeds(markers, 'streets-of-tarkov', [questFlare()])).toEqual([])
  })

  it('the quest done, not yet open or put aside (no line of it here): the exit\'s line again', () => {
    // the Overview leaves such a quest out of its lines, so the list holds only other quests' lines
    const other: QuestRaidLine = { purpose: 'key', objectiveId: 'k1', quest: { objectiveDetails: [{ id: 'k1', type: 'visit', description: '', count: 1 }] } }
    expect(exitFlareNeeds(markers, 'streets-of-tarkov', [other])).toHaveLength(1)
  })

  it('a quest that fires a flare elsewhere: the exit keeps its own line next to it', () => {
    const elsewhere: QuestRaidLine = { purpose: 'signal', objectiveId: 'u1', quest: { objectiveDetails: [{ id: 'u1', type: 'useItem', description: 'Подать сигнал у ворот', count: 1 }] } }
    expect(exitFlareNeeds(markers, 'customs', [elsewhere]).map((marker) => marker.id)).toEqual(['customs-extract-rail'])
  })

  it('a quest that names another exit\'s zone leaves this one its line', () => {
    const named = ceasefire([{ id: 'e1', type: 'extract', description: '', count: 1, zones: [{ id: 'extract-elsewhere', mapId: 'customs', position: { x: 0, z: 0 } }] }])
    expect(exitFlareNeeds(markers, 'customs', [questFlare('e1', named)])).toHaveLength(1)
    const same = ceasefire([{ id: 'e1', type: 'extract', description: '', count: 1, zones: [{ id: 'extract-rail', mapId: 'customs', position: { x: 0, z: 0 } }] }])
    expect(exitFlareNeeds(markers, 'customs', [questFlare('e1', same)])).toEqual([])
  })

  it('an objective kept under its old id still counts', () => {
    const legacy = ceasefire([{ id: 'game-id', legacyId: 'e1', type: 'extract', description: '', count: 1 }])
    expect(exitFlareNeeds(markers, 'streets-of-tarkov', [questFlare('e1', legacy)])).toEqual([])
  })
})

describe('a flare\'s hover card: the pistol, the cartridge and the calibre', () => {
  const pistol = { id: SIGNAL_PISTOL_ID, name: 'Сигнальный пистолет ЗиД СП-81 26x75', iconUrl: '/sp81.webp', caliber: 'Caliber26x75', types: ['gun'] }
  const flares = {
    rspGreen: { id: '6217726288ed9f0845317459', name: 'Реактивный сигнальный патрон РСП-30 (Зеленый)', caliber: 'Caliber26x75', types: ['gun', 'specialSlot'] },
    green: { id: '62389aaba63f32501b1b444f', name: '26x75 сигнальный патрон (Зеленый)', caliber: 'Caliber26x75', types: ['ammo'] },
    red: { id: '62389ba9a63f32501b1b4451', name: '26x75 сигнальный патрон (Красный)', caliber: 'Caliber26x75', types: ['ammo'] },
    yellow: { id: '62389be94d5d474bf712e709', name: '26x75 сигнальный патрон (Желтый)', caliber: 'Caliber26x75', types: ['ammo'] },
    white: { id: '62389bc9423ed1685422dc57', name: '26x75мм осветительный патрон (Белый)', caliber: 'Caliber26x75', types: ['ammo'] },
    acid: { id: '635267f063651329f75a4ee8', name: '26x75mm flare cartridge (Acid Green)', types: ['ammo'] },
    blue: { id: '66d97834d2985e11480d5c1e', name: 'Реактивная сигнальная ракета (Синий)', caliber: 'Caliber26x75', types: ['ammo'] },
    rspRed: { id: '62178c4d4ecf221597654e3d', name: 'RSP-30 reactive signal cartridge (Red)', types: ['gun'] },
  }

  it('every colour is a flare; RSP-30 is fired from the hand; the pistol and other items are not flares', () => {
    for (const item of Object.values(flares)) expect(isFlare(item)).toBe(true)
    expect(isHandFlare(flares.rspGreen)).toBe(true)
    expect(isHandFlare(flares.rspRed)).toBe(true)
    expect(isHandFlare(flares.green)).toBe(false)
    expect(isFlare(pistol)).toBe(false)
    expect(isFlare({ id: 'k1', name: 'Ключ от выхода с Завода' })).toBe(false)
    expect(flareCardOf([{ id: 'k1', name: 'Ключ 219' }], pistol, 'ru')).toBeUndefined()
  })

  it('the green of an exit: the pistol with its 26x75 cartridge and calibre, RSP-30 without one', () => {
    expect(flareCardOf([flares.rspGreen, flares.green], pistol, 'ru')).toEqual({
      caliber: '26x75',
      pistol: { id: SIGNAL_PISTOL_ID, name: 'Сигнальный пистолет ЗиД СП-81 26x75', iconUrl: '/sp81.webp' },
      cartridges: [{ id: flares.green.id, name: flares.green.name, iconUrl: undefined }],
      handFlares: [{ id: flares.rspGreen.id, name: flares.rspGreen.name, iconUrl: undefined }],
    })
  })

  it('every other colour too, and the pistol by name when the catalog has not got it', () => {
    for (const item of [flares.red, flares.yellow, flares.white, flares.acid, flares.blue]) {
      const card = flareCardOf([item], undefined, 'en')
      expect(card?.pistol.name).toBe('ZiD SP-81 26x75 signal pistol')
      expect(card?.caliber).toBe('26x75')
      expect(card?.cartridges.map((cartridge) => cartridge.id)).toEqual([item.id])
    }
  })
})
