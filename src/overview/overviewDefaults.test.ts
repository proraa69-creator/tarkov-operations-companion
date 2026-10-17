import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { baseOverviewLayout, basePhoneLayout, isBuiltInOverview, sanitizeOverviewDefaults } from './overviewDefaults'
import { parseOverviewAnswer, overviewDefaults, reloadOverviewDefaultsForTests, setOverviewDefaults } from './overviewDefaultsStore'
import { defaultOverviewLayout, OVERVIEW_LAYOUT_KEY } from './overviewLayout'
import { PHONE_LAYOUT_KEY } from './phoneLayout'
import { useOverviewEditor } from './useOverviewEditor'
import { usePhoneOverview } from './usePhoneOverview'
import { followAnnouncement } from '../announcement/announcement'

/** «Админ панель» → «Блоки»: the Overview every player starts from (owner, 16.10.2026). */
const OWNER = {
  layout: { stats: ['stat-kappa', 'stat-tasks', 'stat-conditions', 'stat-goons'], rows: ['stats', 'columns', 'priority'], left: ['requirements', 'raid', 'squad'], right: ['favorites', 'tasks', 'gunsmith'] },
  phone: ['raid', 'stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons', 'priority', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites'],
  hidden: ['gunsmith'],
  titles: { tasks: { ru: 'Мои задания', en: 'My tasks' } },
}

beforeEach(() => {
  localStorage.clear()
  reloadOverviewDefaultsForTests()
})
afterEach(() => setOverviewDefaults(null))

describe('the owner\'s Overview defaults', () => {
  it('are made safe: unknown blocks go, every zone is complete, empty and long headings are cut', () => {
    const clean = sanitizeOverviewDefaults({ layout: { left: ['squad', 'nope'] }, phone: ['tasks'], hidden: ['gunsmith', 'gunsmith', 'stats', 'x'], titles: { tasks: { ru: ' Мои ', en: '' }, favorites: { ru: '', en: '' }, nope: { ru: 'x', en: 'x' }, raid: { ru: 'я'.repeat(60), en: '' } } })!
    expect(clean.layout!.left).toEqual(['raid', 'squad', 'requirements'])
    expect(new Set(clean.phone)).toEqual(new Set(['stat-tasks', 'stat-conditions', 'stat-kappa', 'stat-goons', 'priority', 'raid', 'squad', 'requirements', 'tasks', 'gunsmith', 'favorites']))
    expect(clean.phone).toHaveLength(11)
    expect(clean.hidden).toEqual(['gunsmith'])
    expect(Object.keys(clean.titles)).toEqual(['tasks', 'raid'])
    expect(clean.titles.raid.ru).toHaveLength(40)
    expect(sanitizeOverviewDefaults('x')).toBeNull()
    expect(isBuiltInOverview(sanitizeOverviewDefaults({ hidden: [], titles: {} }))).toBe(true)
    expect(isBuiltInOverview(sanitizeOverviewDefaults(OWNER))).toBe(false)
  })

  it('give the starting layouts without the hidden blocks', () => {
    const defaults = sanitizeOverviewDefaults(OWNER)
    expect(baseOverviewLayout(defaults)).toEqual({ ...OWNER.layout, right: ['favorites', 'tasks'] })
    expect(basePhoneLayout(defaults).order).not.toContain('gunsmith')
    expect(basePhoneLayout(defaults).order[0]).toBe('raid')
    expect(baseOverviewLayout(null)).toEqual(defaultOverviewLayout())
  })

  it('come with the notice: `overview` sets them, null brings the built-in Overview back, no field changes nothing', async () => {
    expect(parseOverviewAnswer({ announcement: null })).toBeUndefined()
    expect(parseOverviewAnswer({ overview: null })).toBeNull()
    const answers: unknown[] = [{ announcement: null, overview: OWNER }, { announcement: null }, { announcement: null, overview: null }]
    const ask = async () => answers.shift()
    await followAnnouncement(ask, async () => {}, 1)
    expect(overviewDefaults()?.hidden).toEqual(['gunsmith'])
    // kept in the installation for a start without network
    reloadOverviewDefaultsForTests()
    expect(overviewDefaults()?.titles.tasks.en).toBe('My tasks')
    await followAnnouncement(ask, async () => {}, 1)
    expect(overviewDefaults()?.hidden).toEqual(['gunsmith'])
    await followAnnouncement(ask, async () => {}, 1)
    expect(overviewDefaults()).toBeNull()
  })
})

describe('the Overview follows them', () => {
  it('on the PC: a player who never arranged the blocks gets the owner\'s order at once, hidden blocks go', () => {
    const { result } = renderHook(() => useOverviewEditor())
    expect(result.current.layout).toEqual(defaultOverviewLayout())
    act(() => setOverviewDefaults(sanitizeOverviewDefaults(OWNER)))
    expect(result.current.layout).toEqual({ ...OWNER.layout, right: ['favorites', 'tasks'] })
    expect(result.current.isDefault).toBe(true)
    // following the owner stores nothing of the player's own
    expect(localStorage.getItem(OVERVIEW_LAYOUT_KEY)).toBeNull()
    act(() => setOverviewDefaults(null))
    expect(result.current.layout).toEqual(defaultOverviewLayout())
  })

  it('on the PC: the player\'s own order wins, hidden blocks stay hidden; «Сбросить» goes back to the owner\'s order', () => {
    const own = { stats: ['stat-goons', 'stat-tasks', 'stat-conditions', 'stat-kappa'], rows: ['priority', 'stats', 'columns'], left: ['squad', 'raid', 'requirements'], right: ['gunsmith', 'tasks', 'favorites'] }
    localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(own))
    setOverviewDefaults(sanitizeOverviewDefaults(OWNER))
    const { result } = renderHook(() => useOverviewEditor())
    expect(result.current.layout).toEqual({ ...own, right: ['tasks', 'favorites'] })
    expect(result.current.isDefault).toBe(false)
    act(() => result.current.reset())
    expect(result.current.layout).toEqual({ ...OWNER.layout, right: ['favorites', 'tasks'] })
    expect(localStorage.getItem(OVERVIEW_LAYOUT_KEY)).toBeNull()
  })

  it('on the phone: the owner\'s order until the player\'s own one', () => {
    setOverviewDefaults(sanitizeOverviewDefaults(OWNER))
    const { result, unmount } = renderHook(() => usePhoneOverview())
    expect(result.current.layout.order[0]).toBe('raid')
    expect(result.current.layout.order).not.toContain('gunsmith')
    expect(localStorage.getItem(PHONE_LAYOUT_KEY)).toBeNull()
    act(() => result.current.move('raid', 1))
    expect(localStorage.getItem(PHONE_LAYOUT_KEY)).not.toBeNull()
    unmount()
    act(() => setOverviewDefaults(sanitizeOverviewDefaults({ ...OWNER, phone: [...OWNER.phone].reverse() })))
    const again = renderHook(() => usePhoneOverview())
    expect(again.result.current.layout.order.slice(0, 2)).toEqual(['stat-tasks', 'raid'])
  })
})
