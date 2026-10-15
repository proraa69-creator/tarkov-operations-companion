/**
 * The item the PC recognised last (owner, 15.10.2026: «Информация о предмете будет появляться слева наверху на карте, под
 * кнопкой вид»): the card on «Карты» under «Вид» (components/MapItemCard.tsx). It replaces the item card that was drawn
 * over the game. On the PC it comes from the item key's lookup (electron/experimental/index.ts → `experimental:item`,
 * components/ExperimentalBridge.tsx); on the phone from the server's live relay (mobile/livePosition.ts), as the PC of
 * the same account sent it. Kept while the app runs, whatever page is open, until the next item or «Закрыть»; nothing is
 * stored on the device.
 */
import { useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import type { ItemOverlayInfo, ItemOverlayPayload, QuestNeed } from '../overlay/types'

export interface RecognisedItem {
  payload: Exclude<ItemOverlayPayload, { state: 'idle' }>
  /** When it was recognised (the PC's time; on the phone as the PC sent it). */
  at: number
  /** The game mode it was priced and checked for. */
  mode?: RaidMode
  /** This PC's lookup, or the PC of the account through the server (the phone). */
  from: 'pc' | 'server'
}

let current: RecognisedItem | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const emit = () => { for (const listener of listeners) listener() }

/** A new lookup state or item: it replaces whatever the card showed (an «idle» answer changes nothing). */
export function setRecognisedItem(payload: ItemOverlayPayload, options: { at?: number; mode?: RaidMode; from?: RecognisedItem['from'] } = {}) {
  if (payload.state === 'idle') return
  current = { payload, at: options.at ?? Date.now(), mode: options.mode, from: options.from ?? 'pc' }
  emit()
}

/** «Закрыть» on the card: gone until the next item. */
export function closeRecognisedItem() {
  if (!current) return
  current = null
  emit()
}

export const recognisedItem = () => current

export function useRecognisedItem() {
  return useSyncExternalStore(subscribe, () => current, () => current)
}

/** Every change, outside React (the PC passes found items on to the server for the phone). */
export function onRecognisedItem(listener: (item: RecognisedItem | null) => void) {
  return subscribe(() => listener(current))
}

/** For the tests. */
export function resetRecognisedItemForTests() {
  current = null
  emit()
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined)
const finite = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
const HTTP_URL = /^https?:\/\/[^\s"'<>]+$/

/**
 * The card as it goes to the phone (server/src/routes/live.ts accepts exactly this): what the card shows, nothing of the
 * lookup's diagnostics or of the «Что не продавать» badge.
 */
export function liveItemBody(item: ItemOverlayInfo, at: number) {
  return {
    itemId: item.itemId,
    name: item.name.slice(0, 200),
    ...(item.shortName ? { shortName: item.shortName.slice(0, 80) } : {}),
    ...(item.iconUrl && HTTP_URL.test(item.iconUrl) && item.iconUrl.length <= 600 ? { iconUrl: item.iconUrl } : {}),
    ...(item.weaponPreset ? { weaponPreset: true } : {}),
    ...(finite(item.fleaPrice) !== undefined ? { fleaPrice: item.fleaPrice } : {}),
    ...(item.fleaAverage ? { fleaAverage: true } : {}),
    ...(item.bestTrader && finite(item.bestTrader.price) !== undefined ? { bestTrader: { name: item.bestTrader.name.slice(0, 60), price: item.bestTrader.price } } : {}),
    quests: item.quests.slice(0, 20).map((quest) => ({ questId: quest.questId.slice(0, 80), name: quest.name.slice(0, 200), trader: quest.trader.slice(0, 60), count: Math.max(0, Math.min(100_000, Math.round(quest.count))), kappa: quest.kappa, purpose: quest.purpose.slice(0, 40) })),
    kappa: item.kappa,
    collector: item.collector,
    ...(item.mate ? { mate: true, mateNames: (item.mateNames ?? []).slice(0, 10).map((name) => name.slice(0, 40)) } : {}),
    at: Math.round(at),
  }
}

/** The server's item (GET /v1/live/:mode), shape-checked, as a card; null when it is not one. */
export function parseLiveItem(value: unknown): { payload: ItemOverlayInfo; at: number } | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const itemId = text(raw.itemId, 64)
  const name = text(raw.name, 200)
  const at = finite(raw.at)
  if (!itemId || !name || at === undefined || !Array.isArray(raw.quests)) return null
  const quests: QuestNeed[] = raw.quests.slice(0, 20).flatMap((entry) => {
    const quest = entry as Record<string, unknown> | null
    if (!quest || typeof quest !== 'object' || typeof quest.name !== 'string') return []
    return [{ questId: text(quest.questId, 80) ?? '', name: quest.name.slice(0, 200), trader: text(quest.trader, 60) ?? '', count: finite(quest.count) ?? 1, kappa: quest.kappa === true, purpose: text(quest.purpose, 40) ?? 'нужен' }]
  })
  const iconUrl = text(raw.iconUrl, 600)
  const trader = raw.bestTrader as { name?: unknown; price?: unknown } | undefined
  const traderPrice = trader && typeof trader === 'object' ? finite(trader.price) : undefined
  const mateNames = Array.isArray(raw.mateNames) ? raw.mateNames.filter((entry): entry is string => typeof entry === 'string').slice(0, 10).map((entry) => entry.slice(0, 40)) : []
  return {
    at,
    payload: {
      state: 'found',
      itemId,
      name,
      shortName: text(raw.shortName, 80) ?? name,
      ...(iconUrl && HTTP_URL.test(iconUrl) ? { iconUrl } : {}),
      ...(raw.weaponPreset === true ? { weaponPreset: true } : {}),
      ...(finite(raw.fleaPrice) !== undefined ? { fleaPrice: raw.fleaPrice as number } : {}),
      ...(raw.fleaAverage === true ? { fleaAverage: true } : {}),
      ...(trader && traderPrice !== undefined && typeof trader.name === 'string' ? { bestTrader: { name: trader.name.slice(0, 60), price: traderPrice } } : {}),
      quests,
      kappa: raw.kappa === true,
      collector: raw.collector === true,
      ...(raw.mate === true ? { mate: true, mateNames } : {}),
    },
  }
}
