import type { LivePrices } from '../data/livePrices'
import { steadyFleaPrice } from '../domain/itemPrices'
import type { GunCatalog, GunPart } from './gunTypes'

/**
 * «Сборка оружия» at this minute's flea prices (owner, 02.11.2026: «ты должен изменять сборку в режиме онлайн, прям в
 * приложении. то есть цена изменилась на барахолке, сборка тоже изменилась. что бы были всегда актуальные сборки»): the
 * server's minute snapshot (src/data/livePrices.ts) over the builder catalogue's flea offers — the lowest offer (a lone
 * listing far over the day's average takes the average, itemPrices.ts steadyFleaPrice) and the 24-hour average the
 * builds are priced by (tieredBuilds.ts dayPriced). A part the flea no longer sells loses its flea offer. The same
 * catalogue object when nothing changed, so the builds are solved again only when a price did.
 */
export function withLiveGunPrices(catalog: GunCatalog, live: LivePrices | null): GunCatalog {
  if (!live) return catalog
  let changed = false
  const fresh = <T extends GunPart>(part: T): T => {
    const price = live.items.get(part.id)
    const offer = price && part.offers.find((entry) => entry.vendor === 'flea-market')
    if (!price || !offer) return part
    const flea = price.noFlea ? undefined : steadyFleaPrice(price.lastLowPrice, price.avg24hPrice)?.price
    const average = price.avg24hPrice && price.avg24hPrice > 0 ? price.avg24hPrice : part.fleaAvg24h
    if (flea === offer.priceRUB && average === part.fleaAvg24h) return part
    changed = true
    const offers = flea === undefined ? part.offers.filter((entry) => entry !== offer) : part.offers.map((entry) => entry === offer ? { ...entry, priceRUB: flea } : entry)
    return { ...part, offers, ...(average ? { fleaAvg24h: average } : {}) }
  }
  const weapons = catalog.weapons.map(fresh)
  const mods = new Map([...catalog.mods].map(([id, part]) => [id, fresh(part)]))
  return changed ? { ...catalog, weapons, mods } : catalog
}
