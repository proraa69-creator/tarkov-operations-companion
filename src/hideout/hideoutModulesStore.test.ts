import { afterEach, describe, expect, it } from 'vitest'
import { GYM } from './hideoutModules'
import { hideoutModules, parseHideoutModulesAnswer, reloadHideoutModulesForTests, setHideoutModules } from './hideoutModulesStore'
import { followAnnouncement } from '../announcement/announcement'

const season = { modes: { seasonal: { open: [GYM], hidden: [] } }, updatedAt: '2026-11-20T10:00:00.000Z' }

afterEach(() => {
  setHideoutModules(null)
  localStorage.clear()
})

describe('«Модули убежища» in the app', () => {
  it('reads the setting from the notice: none from a server from before, null for none', () => {
    expect(parseHideoutModulesAnswer({ announcement: null })).toBeUndefined()
    expect(parseHideoutModulesAnswer({ hideoutModules: null })).toBeNull()
    expect(parseHideoutModulesAnswer({ hideoutModules: season })).toEqual(season)
    expect(parseHideoutModulesAnswer({ hideoutModules: 'broken' })).toBeUndefined()
  })

  it('comes with the owner\'s notice the app already asks for: no request of its own', async () => {
    const asked: string[] = []
    await followAnnouncement(async (path) => { asked.push(path); return { version: 1, announcement: null, hideoutModules: season } }, async () => undefined, 1)
    expect(asked).toEqual(['/v1/announcement'])
    expect(hideoutModules()).toEqual(season)
  })

  it('keeps the last setting for a start without network, and drops it when the owner clears it', () => {
    setHideoutModules(season)
    reloadHideoutModulesForTests()
    expect(hideoutModules()).toEqual(season)
    setHideoutModules(null)
    reloadHideoutModulesForTests()
    expect(hideoutModules()).toBeNull()
  })
})
