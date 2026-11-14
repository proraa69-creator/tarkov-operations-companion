import { afterEach, describe, expect, it } from 'vitest'
import { PLAYER_STATE_ADAPTERS } from './playerStateStores'
import { readSquadSettings, setSquadSetting } from '../squad/squadSettings'
import { hideSquadSketch } from '../squad/squadLive'

/**
 * Owner, 15.11.2026: «все отрядные точки, квесты, рисования должны переноситься с ПК на телефон и с телефона на ПК… все должно везде
 * дублироваться». The squad's places, quests and drawings show on the phone's map as on the PC's (both are pages/MapsPage.tsx); what
 * each device kept apart was «Настройки отряда» and the mates' drawings taken off: they travel now.
 */
const prefs = () => PLAYER_STATE_ADAPTERS.find((entry) => entry.kind === 'prefs')!
const MATE = 'a'.repeat(24)

afterEach(() => { localStorage.clear() })

describe('the squad on every device of the account', () => {
  it('«Настройки отряда» and the mates\' drawings taken off travel to the other devices', () => {
    setSquadSetting('location', true)
    setSquadSetting('sketches', true)
    hideSquadSketch(MATE, 'customs', 1_700_000_000_000)
    const kept = prefs().read('')!
    expect(prefs().accepts!(kept.get('raidos-squad-settings-v1'), 'raidos-squad-settings-v1', '')).toBe(true)
    expect(prefs().accepts!(kept.get('raidos-squad-sketch-hidden-v1'), 'raidos-squad-sketch-hidden-v1', '')).toBe(true)
    localStorage.clear()
    expect(readSquadSettings()).toMatchObject({ location: false, sketches: false })
    prefs().write('', kept)
    expect(readSquadSettings()).toEqual({ location: true, sketches: true, quests: true })
    expect(JSON.parse(localStorage.getItem('raidos-squad-sketch-hidden-v1')!)).toEqual({ [`${MATE}:customs`]: 1_700_000_000_000 })
  })

  it('a long list of drawings taken off stays short enough to travel', () => {
    for (let index = 0; index < 80; index += 1) hideSquadSketch(index.toString(16).padStart(24, '0'), `map-${index}`, 1_700_000_000_000 + index)
    const value = prefs().read('')!.get('raidos-squad-sketch-hidden-v1')
    expect(prefs().accepts!(value, 'raidos-squad-sketch-hidden-v1', '')).toBe(true)
  })
})
