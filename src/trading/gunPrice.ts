import { cheapestOffer, type PurchaseAccess } from '../arsenal/buildStats'
import type { GunOffer } from '../arsenal/gunTypes'
import type { ItemBuyOptions } from './itemBuyOptions'

/**
 * «Цена оружия» in «Сборка оружия» (owner, 17.11.2026: «включать в цену стоимость оружия… либо цена с барахолки актуальная,
 * либо… бартер. Так и пиши: цена с барахолки или цена по бартеру, если он доступен. Если недоступен… оружие недоступно.
 * Учитывая все выполненные квесты, уровень персонажа и лояльность торговцев»): the cheapest way this player can get the gun
 * now — a flea or trader offer the builder already judges (cheapestOffer: loyalty, quests, the flea's levels) or an open
 * barter at today's prices of what it asks.
 */
export type GunPriceChoice =
  | { kind: 'flea'; price: number }
  | { kind: 'trader' | 'barter'; price: number; traderName: string; level: number }
  | { kind: 'none' }

export function gunPriceChoice(weapon: { offers: GunOffer[]; noFlea: boolean; fleaLevel?: number }, access: PurchaseAccess, buy: readonly ItemBuyOptions[]): GunPriceChoice {
  const choices: Exclude<GunPriceChoice, { kind: 'none' }>[] = []
  const offer = cheapestOffer(weapon, access)
  if (offer) {
    choices.push(offer.vendor === 'flea-market'
      ? { kind: 'flea', price: offer.priceRUB }
      : { kind: 'trader', price: offer.priceRUB, traderName: offer.vendorName, level: offer.minTraderLevel ?? 1 })
  }
  for (const options of buy) {
    // a trader's cash offer of the gun's default preset (the bare weapon's own are in `weapon.offers`)
    for (const offer of options.traders) if (!offer.lock) choices.push({ kind: 'trader', price: offer.price, traderName: offer.traderName, level: offer.level })
    for (const barter of options.barters) {
      if (barter.lock || barter.total === null) continue
      choices.push({ kind: 'barter', price: Math.round(barter.total / Math.max(1, barter.gives)), traderName: barter.traderName, level: barter.level })
    }
  }
  return choices.sort((a, b) => a.price - b.price)[0] ?? { kind: 'none' }
}
