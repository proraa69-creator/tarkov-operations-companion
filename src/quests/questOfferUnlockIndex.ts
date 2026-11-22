import { useMemo } from 'react'
import type { Item, Quest, QuestOfferUnlock } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import type { AppLocale } from '../i18n/LocaleProvider'

/** Helpers of src/quests/QuestOfferUnlocks.tsx: what a quest opens at the traders, and the other way round. */

export type UnlockKind = 'mods' | 'ammo' | 'items'
export const UNLOCK_KINDS: UnlockKind[] = ['mods', 'ammo', 'items']
export function unlockKind(item?: Pick<Item, 'types' | 'category'>): UnlockKind {
  const types = item?.types ?? []
  if (types.includes('mods')) return 'mods'
  if ((types.includes('ammo') || types.includes('ammoBox')) && !types.includes('grenade')) return 'ammo'
  return 'items'
}

/** «Прапор, ур. 2» / «Prapor, LL2», «бартер» for a barter. */
export function traderLevelText(name: string, level: number, barter: boolean | undefined, locale: AppLocale) {
  const base = locale === 'en' ? `${name}, LL${level}` : `${name}, ур. ${level}`
  return barter ? `${base} · ${locale === 'en' ? 'barter' : 'бартер'}` : base
}

/** The quest's card in «Квесты»: «Текущие» when it is a current quest there, else «Все» (QuestsPage `find`). */
export function questPageHref(questId: string) {
  return `/quests?selected=${encodeURIComponent(questId)}&find=1`
}

/** Item id → the quests that open it at a trader, lowest loyalty first. */
export function itemQuestUnlocks(quests: readonly Quest[] = []): Map<string, Array<QuestOfferUnlock & { quest: Quest }>> {
  const result = new Map<string, Array<QuestOfferUnlock & { quest: Quest }>>()
  for (const quest of quests ?? []) {
    for (const unlock of quest.offerUnlocks ?? []) {
      const list = result.get(unlock.itemId) ?? []
      list.push({ ...unlock, quest })
      result.set(unlock.itemId, list)
    }
  }
  for (const list of result.values()) list.sort((a, b) => a.level - b.level || a.quest.name.localeCompare(b.quest.name, 'ru'))
  return result
}

/** The index of this mode's catalog, built once per catalog. */
export function useItemQuestUnlocks() {
  const { data } = useTarkovData()
  return useMemo(() => itemQuestUnlocks(data.quests), [data.quests])
}
