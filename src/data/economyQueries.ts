import type { AppLocale } from '../i18n/LocaleProvider'

const VENDOR_FIELDS = `priceRUB vendor { name normalizedName ... on TraderOffer { trader { id } minTraderLevel buyLimit taskUnlock { id name } } }`
const COUNT_FIELDS = 'item { id } count'

/** The three bounded requests used by both the client and the server's daily prewarm. */
export function economyQueries(gameMode: 'regular' | 'pve', lang: AppLocale): { prices: string; barters: string; crafts: string } {
  return {
    prices: `{
  fleaMarket(gameMode: ${gameMode}) { enabled sellOfferFeeRate sellRequirementFeeRate }
  items(gameMode: ${gameMode}, lang: ${lang}) {
    id name shortName iconLink basePrice avg24hPrice low24hPrice lastLowPrice types
    buyFor { ${VENDOR_FIELDS} }
    sellFor { ${VENDOR_FIELDS} }
  }
}`,
    barters: `{
  barters(gameMode: ${gameMode}, lang: ${lang}) {
    id level buyLimit
    trader { id name normalizedName }
    taskUnlock { id name }
    requiredItems { ${COUNT_FIELDS} }
    rewardItems { ${COUNT_FIELDS} }
  }
}`,
    crafts: `{
  crafts(gameMode: ${gameMode}, lang: ${lang}) {
    id level duration
    station { id name normalizedName }
    taskUnlock { id name }
    requiredItems { ${COUNT_FIELDS} }
    rewardItems { ${COUNT_FIELDS} }
  }
}`,
  }
}

export function economyQuery(gameMode: 'regular' | 'pve', lang: AppLocale): string {
  return Object.values(economyQueries(gameMode, lang)).join('\n')
}
