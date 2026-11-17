import { describe, expect, it } from 'vitest'
import { SEASON_BORROWED_TASKS, withBorrowedTasks } from './catalogSource'

const task = (id: string, name: string) => ({ id, name, taskRequirements: [] })

describe('reports 184, 185: the Season data lacks the Skier / BTR driver branch', () => {
  it('borrows the listed quests and their quest items from the PvP data, keeps what Season has', () => {
    const friends = '67460662d0fbbc74ca0f7229'
    expect(SEASON_BORROWED_TASKS).toContain(friends)
    expect(SEASON_BORROWED_TASKS).toContain('6744af0969a58fceba101fed')
    const season = { tasks: { a: task('a', 'Season A') }, questItems: { q1: { id: 'q1', name: 'Season item' } } }
    const regular = { tasks: { a: task('a', 'PvP A'), [friends]: task(friends, 'Выбирай друзей правильно'), other: task('other', 'not listed') }, questItems: { q1: { id: 'q1', name: 'PvP item' }, q2: { id: 'q2', name: 'PvP only' } } }
    const merged = withBorrowedTasks(season, regular) as { tasks: Record<string, { name: string }>; questItems: Record<string, { name: string }> }
    expect(Object.keys(merged.tasks).sort()).toEqual(['a', friends].sort())
    expect(merged.tasks.a!.name).toBe('Season A')
    expect(merged.tasks[friends]!.name).toBe('Выбирай друзей правильно')
    expect(merged.questItems.q1!.name).toBe('Season item')
    expect(merged.questItems.q2!.name).toBe('PvP only')
  })

  it('once the Season data has them, nothing changes', () => {
    const season = { tasks: Object.fromEntries(SEASON_BORROWED_TASKS.map((id) => [id, task(id, 'season')])) }
    expect(withBorrowedTasks(season, { tasks: { [SEASON_BORROWED_TASKS[0]!]: task(SEASON_BORROWED_TASKS[0]!, 'pvp') } })).toBe(season)
  })
})
