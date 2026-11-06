import { beforeEach, describe, expect, it } from 'vitest'
import type { Item } from '../domain/types'
import {
  QUEST_KEY_REMIND_AGAIN_MS, QUEST_KEY_REMINDER_AT, clearAllQuestKeyFavorites, clearQuestKeyFavorites, questKeyFavoritesKey, questKeyReminderDue, questKeysToldAt,
  readQuestKeyFavorites, readQuestKeyReminder, rememberQuestKeysTold, setQuestKeyFavorite, staleFavoriteKeys, writeQuestKeyReminder,
} from './questKeyFavorites'
import type { QuestKeyState } from './questKeys'

const row = (id: string, state: QuestKeyState) => ({ item: { id } as Item, state })

describe('«Избранные ключи»', () => {
  beforeEach(() => localStorage.clear())

  it('PvP, PvE and Season apart, and profiles apart', () => {
    setQuestKeyFavorite('p1', 'pvp', 'k1', true)
    setQuestKeyFavorite('p1', 'pve', 'k2', true)
    expect([...readQuestKeyFavorites('p1', 'pvp')]).toEqual(['k1'])
    expect([...readQuestKeyFavorites('p1', 'pve')]).toEqual(['k2'])
    expect(readQuestKeyFavorites('p1', 'seasonal').size).toBe(0)
    expect(readQuestKeyFavorites('p2', 'pvp').size).toBe(0)
    setQuestKeyFavorite('p1', 'pvp', 'k1', false)
    expect(readQuestKeyFavorites('p1', 'pvp').size).toBe(0)
    expect([...readQuestKeyFavorites('p1', 'pve')]).toEqual(['k2'])
  })

  it('what was ticked as «Отмечен в игре» comes back starred; a damaged value reads as nothing', () => {
    localStorage.setItem('raidos-quest-key-marks-v1:p1:pvp', JSON.stringify(['k1', 2]))
    expect([...readQuestKeyFavorites('p1', 'pvp')]).toEqual(['k1'])
    localStorage.setItem('raidos-quest-key-marks-v1:p1:pvp', '{not json')
    expect(readQuestKeyFavorites('p1', 'pvp').size).toBe(0)
  })

  it('a reset takes only its mode; «Удалить все данные» takes all, the switch too', () => {
    setQuestKeyFavorite('p1', 'pvp', 'k1', true)
    setQuestKeyFavorite('p1', 'pve', 'k2', true)
    rememberQuestKeysTold('p1', 'pvp', 5)
    rememberQuestKeysTold('p1', 'pve', 6)
    clearQuestKeyFavorites('p1', 'pvp')
    expect(localStorage.getItem(questKeyFavoritesKey('p1', 'pvp'))).toBeNull()
    expect(questKeysToldAt('p1', 'pvp')).toBeUndefined()
    expect([...readQuestKeyFavorites('p1', 'pve')]).toEqual(['k2'])
    expect(questKeysToldAt('p1', 'pve')).toBe(6)
    writeQuestKeyReminder(true)
    clearAllQuestKeyFavorites()
    expect(readQuestKeyFavorites('p1', 'pve').size).toBe(0)
    expect(readQuestKeyReminder()).toBe(false)
  })

  it('the reminder is off by default; turned on again it may speak at once', () => {
    expect(readQuestKeyReminder()).toBe(false)
    rememberQuestKeysTold('p1', 'pvp', 5)
    writeQuestKeyReminder(true)
    expect(readQuestKeyReminder()).toBe(true)
    expect(questKeysToldAt('p1', 'pvp')).toBeUndefined()
    writeQuestKeyReminder(false)
    expect(readQuestKeyReminder()).toBe(false)
  })

  it('counts only the starred keys under «Больше не нужны»', () => {
    const rows = [row('k1', 'done'), row('k2', 'done'), row('k3', 'needed'), row('k4', 'deferred')]
    expect(staleFavoriteKeys(rows, new Set(['k1', 'k3', 'k4']))).toBe(1)
    expect(staleFavoriteKeys(rows, new Set())).toBe(0)
  })

  it('speaks from 10, at most once a day', () => {
    const now = 1_000_000_000
    expect(QUEST_KEY_REMINDER_AT).toBe(10)
    expect(questKeyReminderDue(9, undefined, now)).toBe(false)
    expect(questKeyReminderDue(10, undefined, now)).toBe(true)
    expect(questKeyReminderDue(25, now - QUEST_KEY_REMIND_AGAIN_MS + 1, now)).toBe(false)
    expect(questKeyReminderDue(25, now - QUEST_KEY_REMIND_AGAIN_MS, now)).toBe(true)
  })
})
