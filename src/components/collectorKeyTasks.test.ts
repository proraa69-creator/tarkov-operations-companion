import { describe, expect, it } from 'vitest'
import type { ModeProgress, Quest, TaskProgressRecord } from '../domain/types'
import { createLocalProfile } from '../domain/progress'
import { calculateAvailability } from '../progression/requirementEngine'
import { collectorKeyTasks } from './collectorKeyTasks'

const quest = (normalizedName: string, name: string, trader: string): Quest => ({ id: `id-${normalizedName}`, normalizedName, name, trader, level: 1, kappa: false, description: '', objectives: [], rewards: [] })
const quests: Quest[] = [
  quest('chemical-part-4', 'Реагент. Часть 4', 'Лыжник'),
  quest('big-customer', 'Большой заказчик', 'Прапор'),
  quest('out-of-curiosity', 'Простое любопытство', 'Терапевт'),
  quest('shooter-born-in-heaven', 'Стрелок от бога', 'Механик'),
  quest('the-tarkov-shooter-part-4', 'Тарковский стрелок. Часть 4', 'Егерь'),
]
const record = (taskId: string, status: TaskProgressRecord['status']): TaskProgressRecord => ({ taskId, status, source: 'eft-log', updatedAt: '2026-10-08T10:00:00.000Z' })
const withProgress = (records: TaskProgressRecord[]): ModeProgress => ({ ...createLocalProfile('TEST', 'collector').modes.pvp, taskProgress: Object.fromEntries(records.map((entry) => [entry.taskId, entry])) })

describe('collectorKeyTasks', () => {
  it('lists the four key tasks; an alternative closes «Реагент. Часть 4»', () => {
    const progress = withProgress([record('id-big-customer', 'completed'), record('id-the-tarkov-shooter-part-4', 'active')])
    const rows = collectorKeyTasks(quests, calculateAvailability(quests, progress))
    expect(rows.map((row) => [row.name, row.state, row.quest?.id])).toEqual([
      ['Реагент. Часть 4', 'completed', 'id-big-customer'],
      ['Стрелок от бога', 'open', 'id-shooter-born-in-heaven'],
      ['Тарковский стрелок. Часть 4', 'active', 'id-the-tarkov-shooter-part-4'],
      // not in this catalog: the owner's name, nothing to open
      ['Шить — не тужить. Часть 4', 'open', undefined],
    ])
    expect(rows[0].alternatives.map((alt) => alt.name)).toEqual(['Большой заказчик', 'Простое любопытство'])
  })
})
