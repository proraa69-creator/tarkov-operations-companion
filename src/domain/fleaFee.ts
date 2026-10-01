/**
 * Flea market listing fee («комиссия барахолки»).
 *
 * Formula from the Escape from Tarkov wiki, «Trading → Flea Market → Fees»
 * (https://escapefromtarkov.fandom.com/wiki/Trading#Fees):
 *
 *   Fee = V0 · Ti · 4^P0 · Q + VR · Tr · 4^PR · Q
 *
 *   V0 — the item's base price (tarkov.dev `basePrice`, per unit),
 *   VR — the asking price (per unit),
 *   Ti, Tr — the offer and requirement fee rates (tarkov.dev `fleaMarket.sellOfferFeeRate` / `sellRequirementFeeRate`, both 0.03),
 *   Q — the number of items in the offer,
 *   P0 = log10(V0 / VR), raised to the power 1.08 when VR < V0,
 *   PR = log10(VR / V0), raised to the power 1.08 when VR ≥ V0.
 *
 * Intelligence Center level 3 lowers the fee by 30%; the Hideout Management skill strengthens hideout bonuses by
 * 1% per level (wiki «Hideout management»), so the reduction is 30% × (1 + level / 100). Same approach as
 * tarkov.dev's own `fleaMarketFee` field.
 */
export interface FleaFeeOptions {
  count?: number
  offerFeeRate?: number
  requirementFeeRate?: number
  intelCenterLevel?: number
  hideoutManagementLevel?: number
}

export const DEFAULT_OFFER_FEE_RATE = 0.03
export const DEFAULT_REQUIREMENT_FEE_RATE = 0.03

export function fleaMarketFee(basePrice: number, sellPrice: number, options: FleaFeeOptions = {}): number {
  const {
    count = 1,
    offerFeeRate = DEFAULT_OFFER_FEE_RATE,
    requirementFeeRate = DEFAULT_REQUIREMENT_FEE_RATE,
    intelCenterLevel = 0,
    hideoutManagementLevel = 0,
  } = options
  if (!(basePrice > 0) || !(sellPrice > 0) || !(count > 0)) return 0
  const v0 = basePrice
  const vr = sellPrice
  let p0 = Math.log10(v0 / vr)
  if (vr < v0) p0 = Math.pow(p0, 1.08)
  let pr = Math.log10(vr / v0)
  if (vr >= v0) pr = Math.pow(pr, 1.08)
  let fee = v0 * offerFeeRate * Math.pow(4, p0) * count + vr * requirementFeeRate * Math.pow(4, pr) * count
  if (intelCenterLevel >= 3) {
    const management = Math.min(51, Math.max(0, hideoutManagementLevel))
    fee *= 1 - 0.3 * (1 + management / 100)
  }
  return Math.round(fee)
}

/** What the seller keeps after listing `count` items at `sellPrice` each. */
export function fleaNetProceeds(basePrice: number, sellPrice: number, options: FleaFeeOptions = {}): number {
  const count = options.count ?? 1
  return Math.round(sellPrice * count) - fleaMarketFee(basePrice, sellPrice, options)
}
