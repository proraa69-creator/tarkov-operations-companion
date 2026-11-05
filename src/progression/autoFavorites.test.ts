import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_FAVORITES_EVENT, autoFavoriteIds, clearAllAutoFavorites, forgetAutoFavorite, recordAutoFavorites, releaseAutoFavorites, takeAutoFavoriteRemovals,
} from './autoFavorites'
import { deferQuest, restoreDeferredQuests } from './deferredQuests'

afterEach(() => localStorage.clear())

describe('«Предметы в избранное»: what the feature added, and for which quests', () => {
  it('an item leaves «Избранное» once the last quest that keeps it comes back, in its own mode only', () => {
    // the camera added now for two quests in PvP; the key was the player's own (not added): not the feature's
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'reminds', itemIds: ['camera', 'key'] }, { mode: 'pvp', questId: 'watch', itemIds: ['camera'] }], ['camera'])
    // the same quest put aside in PvE keeps the camera too
    recordAutoFavorites('p1', [{ mode: 'pve', questId: 'watch', itemIds: ['camera'] }], [])
    expect(autoFavoriteIds('p1')).toEqual(['camera'])
    releaseAutoFavorites('p1', 'pvp', ['reminds', 'watch'])
    expect(takeAutoFavoriteRemovals('p1')).toEqual([])
    releaseAutoFavorites('p1', 'pve', ['watch'])
    expect(takeAutoFavoriteRemovals('p1')).toEqual(['camera'])
    // taken once
    expect(takeAutoFavoriteRemovals('p1')).toEqual([])
    expect(autoFavoriteIds('p1')).toEqual([])
  })

  it('a quest put aside again before the removal keeps the item after all', () => {
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q', itemIds: ['marker'] }], ['marker'])
    releaseAutoFavorites('p1', 'pvp', ['q'])
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q2', itemIds: ['marker'] }], ['marker'])
    expect(takeAutoFavoriteRemovals('p1')).toEqual([])
    expect(autoFavoriteIds('p1')).toEqual(['marker'])
  })

  it('an item the player stars or unstars himself is his: never taken out', () => {
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q', itemIds: ['marker', 'flash'] }], ['marker', 'flash'])
    forgetAutoFavorite('p1', 'marker')
    releaseAutoFavorites('p1', 'pvp', ['q'])
    expect(takeAutoFavoriteRemovals('p1')).toEqual(['flash'])
    // waiting to be taken out, then starred by hand: stays
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q', itemIds: ['gpu'] }], ['gpu'])
    releaseAutoFavorites('p1', 'pvp', ['q'])
    forgetAutoFavorite('p1', 'gpu')
    expect(takeAutoFavoriteRemovals('p1')).toEqual([])
  })

  it('profiles apart; a damaged value reads as nothing added; «Удалить все данные» clears them', () => {
    recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q', itemIds: ['marker'] }], ['marker'])
    expect(autoFavoriteIds('p2')).toEqual([])
    localStorage.setItem('raidos-auto-favorites-v1:p3', '{oops')
    expect(autoFavoriteIds('p3')).toEqual([])
    clearAllAutoFavorites()
    expect(autoFavoriteIds('p1')).toEqual([])
  })

  it('«Вернуть» lets go of the quest\'s items and tells the app', () => {
    const heard = vi.fn()
    window.addEventListener(AUTO_FAVORITES_EVENT, heard)
    try {
      deferQuest('p1', 'pvp', 'q')
      recordAutoFavorites('p1', [{ mode: 'pvp', questId: 'q', itemIds: ['marker'] }], ['marker'])
      heard.mockClear()
      // not put aside in PvE: nothing comes back there
      restoreDeferredQuests('p1', 'pve', ['q'])
      expect(takeAutoFavoriteRemovals('p1')).toEqual([])
      restoreDeferredQuests('p1', 'pvp', ['q'])
      expect(heard).toHaveBeenCalled()
      expect(takeAutoFavoriteRemovals('p1')).toEqual(['marker'])
    } finally {
      window.removeEventListener(AUTO_FAVORITES_EVENT, heard)
    }
  })
})
