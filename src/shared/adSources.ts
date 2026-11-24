/**
 * «Реклама» (owner, 09.11.2026: «чтобы было видно, сколько человек пришло с Reddit рекламы»): our own label on the
 * ad's link, https://raidos.app/?utm_source=reddit&utm_campaign=<name>. The site counts the visit (server, POST
 * /v1/accounts/ad-visits) and remembers the label for the registration; the server also marks an account made in the PC
 * app from the same network within AD_ATTRIBUTION_MS. Statistics only: no discount, nothing for a streamer, and nothing
 * is sent to the ad platform. A new platform is one more entry in AD_SOURCES.
 */
export const AD_SOURCES = ['reddit'] as const
export type AdSource = typeof AD_SOURCES[number]
export const AD_SOURCE_LABEL: Record<AdSource, string> = { reddit: 'Reddit' }

/** Where an account came from: the platform and, when the link names one, the campaign. */
export interface AdMark { source: AdSource; campaign?: string }

/** The site's address the ad links lead to. */
export const AD_SITE_URL = 'https://raidos.app/'
/** How long the site keeps the label for a registration, and the server a visitor's network: 7 days. */
export const AD_ATTRIBUTION_MS = 7 * 24 * 60 * 60 * 1000

export function normalizeAdSource(raw: unknown): AdSource | undefined {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return (AD_SOURCES as readonly string[]).includes(value) ? value as AdSource : undefined
}

/**
 * The campaign as kept: lowercase latin letters, digits, «_» and «-», at most 32 (other characters become «-»), so a
 * name typed in the ad's link («Spring Sale») and Reddit's own ids both read the same. Undefined when nothing is left.
 */
export function normalizeAdCampaign(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  return value || undefined
}

/** A usable label, or undefined: an unknown platform is not counted at all. */
export function normalizeAdMark(source: unknown, campaign?: unknown): AdMark | undefined {
  const known = normalizeAdSource(source)
  if (!known) return undefined
  const name = normalizeAdCampaign(campaign)
  return name ? { source: known, campaign: name } : { source: known }
}

/**
 * The click id a platform adds to every ad link by itself (Reddit: `rdt_cid`), so an ad that leads to the bare address
 * counts too (owner, 09.11.2026: the ads led to raidos.app/?rdt_cid=… and «Реклама» stayed empty). Only the platform is
 * taken from it; the id itself is never sent or stored.
 */
export const AD_CLICK_IDS: Readonly<Record<string, AdSource>> = { rdt_cid: 'reddit' }

/** The ad label of a page address's query: `utm_source` (+ `utm_campaign`), else a platform's own click id. */
export function adMarkFromSearch(search: string): AdMark | undefined {
  const params = new URLSearchParams(search)
  const campaign = params.get('utm_campaign')
  const labelled = normalizeAdMark(params.get('utm_source'), campaign)
  if (labelled) return labelled
  const clickId = Object.keys(AD_CLICK_IDS).find((name) => params.get(name))
  return clickId ? normalizeAdMark(AD_CLICK_IDS[clickId], campaign) : undefined
}

/** The link for an ad: https://raidos.app/?utm_source=reddit&utm_campaign=<campaign>. */
export function adLink(source: AdSource, campaign?: string) {
  const name = normalizeAdCampaign(campaign)
  return `${AD_SITE_URL}?utm_source=${source}${name ? `&utm_campaign=${name}` : ''}`
}
