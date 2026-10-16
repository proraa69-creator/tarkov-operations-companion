/**
 * Trader portraits shipped inside the app (owner, 12.10.2026: «почему у торговцев нету картинок в окошках»). The app
 * shows pictures only from itself and raidos.app (src/app/contentSecurityPolicy.ts), and the catalog from our server
 * carries no portrait for traders, so the cards showed a letter. These are tarkov.dev's 128 px portraits as WebP
 * (about 4 KB each); a trader that is not here keeps whatever picture the catalog has, else the letter.
 */
const urls = import.meta.glob<string>('../assets/trader-portraits/*.webp', { eager: true, query: '?url', import: 'default' })
const byKey = new Map(Object.entries(urls).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))

/** tarkov.dev trader ids → the file, so a catalog without normalized names (offline, older caches) still finds them. */
const BY_ID: Record<string, string> = {
  '54cb50c76803fa8b248b4571': 'prapor',
  '54cb57776803fa99248b456e': 'therapist',
  '579dc571d53a0658a154fbec': 'fence',
  '58330581ace78e27b8b10cee': 'skier',
  '5935c25fb3acc3127c3d8cd9': 'peacekeeper',
  '5a7c2eca46aef81a7ca2145d': 'mechanic',
  '5ac3b934156ae10c4430e83c': 'ragman',
  '5c0647fdd443bc2504c2d371': 'jaeger',
  '638f541a29ffd1183d187f57': 'lightkeeper',
  '68fe15910f29ba3fdbba9d54': 'taran',
  '68fe15990f29ba3fdbba9d55': 'radio-station',
  '656f0f98d80a697f855d34b1': 'btr-driver',
  '6617beeaa9cfa777ca915b7c': 'ref',
  '688246518448b05efd61d461': 'mr-kerman',
  '688246958448b05efd61d462': 'voevoda',
  '69e0d6cc77b63940375b9173': 'survivor',
}

/** The trader's portrait: the one in the app (by normalized name, tarkov.dev id or the demo data's id), else the catalog's. */
export function traderPortrait(trader: { id?: string; normalizedName?: string; imageUrl?: string } | undefined): string | undefined {
  if (!trader) return undefined
  const key = [trader.normalizedName, trader.id ? BY_ID[trader.id] : undefined, trader.id].find((entry) => entry && byKey.has(entry))
  return key ? byKey.get(key) : trader.imageUrl || undefined
}
