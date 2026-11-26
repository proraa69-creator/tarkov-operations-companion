import { afterEach, describe, expect, it } from 'vitest'
import { PLAYER_STATE_ADAPTERS } from '../sync/playerStateStores'
import { exitRequirementsShown, setExitRequirementsShown } from './exitRequirementsSetting'

// Report 235 (owner, 25.11.2026): «сделай в настройках кнопку в интерфейсе „Показывать требования для выхода“».
const KEY = 'raidos-exit-requirements-v1'
const prefs = () => PLAYER_STATE_ADAPTERS.find((entry) => entry.kind === 'prefs')!

afterEach(() => { localStorage.clear() })

describe('«Показывать требования для выхода»', () => {
  it('on until the player turns it off, and kept so', () => {
    expect(exitRequirementsShown()).toBe(true)
    setExitRequirementsShown(false)
    expect(exitRequirementsShown()).toBe(false)
    expect(localStorage.getItem(KEY)).toBe('0')
    setExitRequirementsShown(true)
    expect(exitRequirementsShown()).toBe(true)
  })

  it('goes to the account\'s other devices with the player\'s switches, the phone\'s Overview told', () => {
    setExitRequirementsShown(false)
    const kept = prefs().read('')!
    expect(prefs().accepts!(kept.get(KEY), KEY, '')).toBe(true)
    localStorage.clear()
    expect(exitRequirementsShown()).toBe(true)
    let told = 0
    const listener = () => { told += 1 }
    window.addEventListener('raidos-exit-requirements-changed', listener)
    try { prefs().write('', kept) } finally { window.removeEventListener('raidos-exit-requirements-changed', listener) }
    expect(exitRequirementsShown()).toBe(false)
    expect(told).toBe(1)
  })
})
