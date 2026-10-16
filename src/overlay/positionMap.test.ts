import { describe, expect, it } from 'vitest'
import { placePlayer, POSITION_FRESH_MS, withinBounds } from './positionMap'
import { canonicalMapId } from '../data/mapIds'

const now = Date.parse('2026-10-16T18:00:00Z')
const labs: [[number, number], [number, number]] = [[-80, -477], [-287, -193]]
const shot = (at = now) => ({ x: -230.88, z: -375.83, at })

describe('the map of the player\'s dot', () => {
  it('the raid\'s map from the logs wins; a screenshot from before the raid is not the position', () => {
    expect(placePlayer({ mapId: 'the-lab', position: shot(), raidMapId: 'the-lab', raidSince: now - 1000, now })).toEqual({ onThisMap: true, guessed: false, reason: 'raid-map' })
    expect(placePlayer({ mapId: 'customs', position: shot(), raidMapId: 'the-lab', now })).toMatchObject({ onThisMap: false, reason: 'other-raid-map' })
    expect(placePlayer({ mapId: 'the-lab', position: shot(now - 5000), raidMapId: 'the-lab', raidSince: now - 1000, now })).toMatchObject({ onThisMap: false, reason: 'before-raid' })
  })

  it('no map in the logs: the open map, while fresh, after no seen raid end, with coordinates on it', () => {
    expect(placePlayer({ mapId: 'the-lab', position: shot(), raidMapId: '', bounds: labs, now })).toEqual({ onThisMap: true, guessed: true, reason: 'shown-map' })
    expect(placePlayer({ mapId: 'the-lab', position: shot(), raidMapId: '', now })).toMatchObject({ onThisMap: true })
    expect(placePlayer({ mapId: 'the-lab', position: shot(now - POSITION_FRESH_MS), raidMapId: '', bounds: labs, now })).toMatchObject({ onThisMap: false, reason: 'stale' })
    expect(placePlayer({ mapId: 'the-lab', position: shot(now - 1000), raidMapId: '', raidEndedAt: now - 500, bounds: labs, now })).toMatchObject({ onThisMap: false, reason: 'after-raid' })
    expect(placePlayer({ mapId: 'factory', position: shot(), raidMapId: '', bounds: [[-64, -58], [74, 62]], now })).toMatchObject({ onThisMap: false, reason: 'off-map' })
    expect(placePlayer({ mapId: 'the-lab', position: null, raidMapId: 'the-lab', now })).toMatchObject({ onThisMap: false, reason: 'no-position' })
  })

  it('bounds in either corner order, with a margin', () => {
    expect(withinBounds({ x: -230, z: -375 }, labs)).toBe(true)
    expect(withinBounds({ x: -230, z: -375 }, [[-287, -193], [-80, -477]])).toBe(true)
    expect(withinBounds({ x: -75, z: -480 }, labs)).toBe(true)
    expect(withinBounds({ x: 200, z: -375 }, labs)).toBe(false)
  })

  it('the game\'s location names map to the app\'s maps (factory4_day was missing)', () => {
    for (const [name, id] of [['factory4_day', 'factory'], ['factory4_night', 'factory'], ['bigmap', 'customs'], ['Interchange', 'interchange'], ['RezervBase', 'reserve'], ['laboratory', 'the-lab'], ['TarkovStreets', 'streets-of-tarkov'], ['Sandbox_high', 'ground-zero'], ['Lighthouse', 'lighthouse'], ['Shoreline', 'shoreline'], ['Woods', 'woods'], ['Labyrinth', 'the-labyrinth']]) {
      expect(canonicalMapId(name), name).toBe(id)
    }
  })
})
