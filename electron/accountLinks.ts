import { isOwnerBuild } from './buildEdition.js'
import { LOCAL_SITE_URL } from './localServer.js'
import { publicSiteUrl, tunnelStatus } from './publicTunnel.js'
import { apiBaseUrl, createMobileLoginCode, isLocalAddress, loadServerUrl } from './serviceGateway.js'

/**
 * Where the account website is for this app:
 * - TARKOV_WEBSITE_URL, when set;
 * - the server's own address when it is not this PC: the owner's public address serves the site and forwards /v1 to
 *   the API (electron/localServer.ts), so a player's app opens the right site without any setting;
 * - on the owner's PC: the local site; for a phone (`forPhone`) the public link of the server on this PC if it is on.
 */
export async function websiteBase(options: { forPhone?: boolean } = {}) {
  const configured = process.env.TARKOV_WEBSITE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  await loadServerUrl()
  let api = ''
  try { api = apiBaseUrl() } catch { /* invalid address: fall through to this PC */ }
  if (api && !isLocalAddress(api)) return new URL(api).origin
  const tunnel = options.forPhone && isOwnerBuild() ? await ownerPublicSite() : ''
  return (tunnel || LOCAL_SITE_URL).replace(/\/+$/, '')
}

/** The owner's permanent address, or the running free link (trycloudflare), or ''. */
async function ownerPublicSite() {
  const permanent = await publicSiteUrl().catch(() => '')
  if (permanent) return permanent
  const tunnel = await tunnelStatus().catch(() => null)
  return tunnel?.state === 'on' && tunnel.url ? tunnel.url : ''
}

export interface MobileLoginLink {
  /** What the QR code holds: the website page that opens the phone app (or signs in on the site). */
  url: string
  expiresAt: string
  /** false: the address is this PC only (127.0.0.1 / localhost), a phone cannot reach it. */
  reachable: boolean
}

/**
 * «Войти в мобильную версию». The link is `<site>/app-login#login=<code>&server=<site>`: the code (two minutes, works
 * once) and the server stay in the fragment, which the browser never sends to any server. The page hands them to the
 * phone app (tarkovoperator://login…) or, without the app, signs in on the website.
 */
export async function mobileLoginLink(): Promise<MobileLoginLink> {
  const site = await websiteBase({ forPhone: true })
  const { code, expiresAt } = await createMobileLoginCode()
  const params = new URLSearchParams({ login: code, server: site })
  return { url: `${site}/app-login#${params.toString()}`, expiresAt, reachable: !isLocalAddress(site) }
}
