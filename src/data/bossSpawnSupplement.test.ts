import { describe, expect, it } from 'vitest'
import { adaptLiveMapMarkers } from './mapMarkerAdapter'
import { BOSS_SPAWN_SUPPLEMENT, resolveSupplementArea, supplementBossesFor } from './bossSpawnSupplement'
import { translateUiText } from '../i18n/uiEnglish'
import { maps } from './demo'
import type { GameMap, MapMarker, RaidMode } from '../domain/types'

const withTerminal: GameMap[] = [...maps, { ...maps[0], id: 'terminal', name: 'Терминал', labels: undefined }]
const bossMarkers = (root: Record<string, unknown>, mode?: RaidMode, mapList: GameMap[] = maps): MapMarker[] =>
  adaptLiveMapMarkers(root, {}, { maps: mapList, quests: [], items: new Map(), mapNameByApiId: new Map(), mode }).filter((marker) => marker.layerId === 'boss')

const mobs = {
  bossBully: { name: 'Решала', normalizedName: 'reshala' },
  bossKnight: { name: 'Knight', normalizedName: 'knight' },
  bossSanitar: { name: 'Санитар', normalizedName: 'sanitar' },
  bossZryachiy: { name: 'Зрячий', normalizedName: 'zryachiy' },
  exUsec: { name: 'Отступник', normalizedName: 'rogue' },
  bossKilla: { name: 'Килла', normalizedName: 'killa' },
}

describe('boss spawn supplement (research list 30.09.2026)', () => {
  it('adds nothing when the mode is unknown (tests / callers without a mode keep the live feed only)', () => {
    expect(bossMarkers({ mobs, maps: { shoreline: { normalizedName: 'shoreline', bosses: [] } } })).toEqual([])
  })

  it('adds Black Division on Shoreline only in Season, and the live Sanitar wins over the list', () => {
    const root = { mobs, maps: { shoreline: { normalizedName: 'shoreline', bosses: [
      { mob: 'bossSanitar', spawnChance: 0.6, spawnLocations: [{ name: 'ZonePort', positions: [{ x: -323, y: -62, z: 498 }] }] },
    ] } } }
    const season = bossMarkers(root, 'seasonal')
    const titles = (list: MapMarker[]) => [...new Set(list.map((marker) => marker.title))].sort()
    expect(titles(season)).toEqual(['Black Division', 'Жрец культа', 'Кочевники', 'Партизан', 'Санитар'])
    expect(titles(bossMarkers(root, 'pvp'))).not.toContain('Black Division')
    expect(titles(bossMarkers(root, 'pve'))).not.toContain('Black Division')
    // Sanitar: only the live markers (port + the adapter's own resort zone), no supplement resort/pier markers.
    expect(new Set(season.filter((marker) => marker.title === 'Санитар').map((marker) => marker.source))).toEqual(new Set(['json.tarkov.dev/maps']))
    const bd = season.find((marker) => marker.title === 'Black Division')!
    expect(bd).toMatchObject({ approximate: true, source: 'boss-spawn-supplement', meta: '35%' })
    expect(bd.boss).toMatchObject({ spawnChance: 0.35, locationName: 'Санаторий' })
    // At the tarkov.dev «Resort» label (game x -258.2, z -71.2 → [lat = z, lng = x]).
    expect(bd.position).toEqual([-71.2, -258.2])
    expect(bd.description).toContain('Сезон 35%')
    expect(translateUiText(bd.description)).toContain('Possible spawn zone: Health Resort.')
    expect(translateUiText(bd.description)).not.toMatch(/[А-Яа-яЁё]/)
  })

  it('does not add a boss the live feed lists with an explicit 0 % for this mode', () => {
    const root = { mobs, maps: { customs: { normalizedName: 'customs', bosses: [
      { mob: 'bossKnight', spawnChance: 0, spawnLocations: [{ name: 'ZoneScavBase', positions: [{ x: 208, y: 1, z: -116 }] }] },
    ] } } }
    const titles = bossMarkers(root, 'pve').map((marker) => marker.title)
    expect(titles).not.toContain('Кочевники')
    expect(titles).toContain('Решала')
    expect(titles).toContain('Партизан')
  })

  it('moves the Lighthouse Rogues to the chalets: old treatment-plant zones are dropped and the chalets added', () => {
    const root = { mobs, maps: { lighthouse: { normalizedName: 'lighthouse', bosses: [
      { mob: 'exUsec', spawnChance: 1, spawnLocations: [{ name: 'Zone_TreatmentContainers', positions: [{ x: -60, y: 10, z: -590 }] }] },
      { mob: 'bossZryachiy', spawnChance: 1, spawnLocations: [{ name: 'Zone_Island', positions: [{ x: 390, y: 20, z: 500 }] }] },
    ] } } }
    const rogues = bossMarkers(root, 'seasonal').filter((marker) => marker.title === 'Отступники')
    expect(rogues.map((marker) => marker.boss?.locationName).sort()).toEqual(['Курорт Pikes Peak (шале)', 'Шале'])
    expect(rogues.every((marker) => marker.approximate && marker.boss?.spawnChance === 0.8)).toBe(true)
    // PvP: in the list with an unknown chance → shown, without a percentage.
    const pvp = bossMarkers(root, 'pvp').filter((marker) => marker.title === 'Отступники')
    expect(pvp).toHaveLength(2)
    expect(pvp[0].boss?.spawnChance).toBeUndefined()
    expect(pvp[0].description).toContain('PvP шанс неизвестен')
    // A live chalet zone wins.
    const live = bossMarkers({ mobs, maps: { lighthouse: { normalizedName: 'lighthouse', bosses: [
      { mob: 'exUsec', spawnChance: 1, spawnLocations: [{ name: 'Zone_Chalet', positions: [{ x: -130, y: 10, z: 95 }] }] },
    ] } } }, 'seasonal').filter((marker) => marker.boss?.key === 'rogue')
    expect(live.map((marker) => marker.source)).toEqual(['json.tarkov.dev/maps'])
  })

  it('draws every live Rogue zone by the chalets and none at the old water treatment plant (report 233)', () => {
    // The live Lighthouse feed of 25.11.2026: four Zone_Chalet listings on the same four points, one Zone_Rocks listing.
    const chalet = [{ x: -62.1, y: 19.8, z: -134.3 }, { x: -123.6, y: 18.2, z: -132.7 }, { x: -81, y: 16.4, z: 19.3 }, { x: -124.5, y: 18.2, z: -135.5 }]
    const rocks = [{ x: -69.2, y: 26.8, z: 112.9 }, { x: -113.2, y: 30.7, z: 153.7 }]
    const listing = (spawnChance: number, name: string, positions: Array<{ x: number; y: number; z: number }>) => ({ mob: 'exUsecFree', spawnChance, spawnLocations: [{ name, chance: 1, positions }] })
    const root = { mobs: { ...mobs, exUsecFree: { name: 'exUsecFree', normalizedName: 'rogue' } }, maps: { lighthouse: { normalizedName: 'lighthouse', bosses: [
      listing(1, 'Zone_Chalet', chalet), listing(0.9, 'Zone_Chalet', chalet), listing(0.5, 'Zone_Chalet', chalet), listing(0.5, 'Zone_Chalet', chalet),
      listing(0.7, 'Zone_Rocks', rocks),
      // The old base: a zone of its old names (SPT 08.2026), and a zone of any name standing in the plant.
      listing(0.8, 'Zone_RoofBeach', [{ x: 30, y: 15, z: -600 }]),
      listing(0.5, 'Zone_Anything', [{ x: -100, y: 15, z: -700 }]),
    ] } } }
    for (const mode of ['pvp', 'pve', 'seasonal'] as RaidMode[]) {
      const rogues = bossMarkers(root, mode).filter((marker) => marker.boss?.key === 'rogue')
      // The south of the chalets, and their north with the rocks above the tennis court (the chalet-only rule dropped the rocks).
      expect(rogues.map((marker) => marker.position)).toEqual([[-132.7, -123.6], [19.3, -81]])
      expect(rogues.map((marker) => marker.boss?.locationName)).toEqual(['Chalet', 'Chalet, Rocks'])
      expect(new Set(rogues.map((marker) => marker.source))).toEqual(new Set(['json.tarkov.dev/maps']))
    }
  })

  it('puts Terminal’s missing bosses into the live port zone, one marker per boss', () => {
    const root = { mobs, maps: { terminal: { normalizedName: 'terminal', bosses: [
      { mob: 'bossKilla', spawnChance: 0.2, spawnLocations: [{ name: '2ScavPort29', positions: [{ x: 120, y: 5, z: -300 }] }] },
    ] } } }
    const markers = bossMarkers(root, 'pvp', withTerminal)
    expect(markers.map((marker) => marker.title).sort()).toEqual(['Black Division', 'Глухарь', 'Килла', 'Решала', 'Санитар', 'Тагилла'])
    for (const marker of markers.filter((entry) => entry.source === 'boss-spawn-supplement')) expect(marker.position).toEqual([-300, 120])
    // Without a live port zone: the Seaport Terminal label.
    const alone = bossMarkers({ mobs, maps: { terminal: { normalizedName: 'terminal', bosses: [] } } }, 'pve', withTerminal)
    expect(alone).toHaveLength(6)
    expect(alone[0].position).toEqual([-238.5, 286.3])
  })

  it('resolves a label by name from the loaded map config before the stored position', () => {
    const area = BOSS_SPAWN_SUPPLEMENT.lighthouse.find((boss) => boss.key === 'rogue')!.areas[0]
    expect(resolveSupplementArea(area, { labels: [{ text: 'Grand Chalet', x: -140, z: 110 }] }, [])).toEqual({ x: -140, z: 110 })
    expect(resolveSupplementArea(area, {}, [])).toEqual({ x: -133, z: 100 })
  })

  it('lists every boss of the research list for a map and mode when the feed has none', () => {
    const keys = (mapId: string, mode: RaidMode) => supplementBossesFor(mapId, mode, { present: [], zeroed: [] }).map((boss) => boss.key)
    expect(keys('customs', 'pvp')).toEqual(['reshala', 'goons', 'partisan', 'cultist-priest'])
    expect(keys('streets-of-tarkov', 'pve')).toEqual(['kaban', 'kollontay'])
    expect(keys('streets-of-tarkov', 'seasonal')).toEqual(['kaban', 'kollontay', 'black-division'])
    expect(keys('ground-zero', 'pvp')).toEqual([])
    expect(keys('ground-zero', 'seasonal')).toEqual(['black-division'])
    // Live group «goons» (Knight) and name matches count as present.
    expect(supplementBossesFor('woods', 'pve', { present: [{ key: 'goons', name: 'Кочевники' }, { key: 'shturman', name: 'Штурман' }], zeroed: [] }).map((boss) => boss.key)).toEqual(['partisan', 'cultist-priest'])
  })
})
