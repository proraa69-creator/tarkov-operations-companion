/**
 * The only way the app talks to the Raid OS API server (main process only).
 *
 * - Base URL: env TARKOV_API_URL, else the address saved in the app, else the build's default server
 *   (https://raidos.app, scripts/write-build-info.mjs), else this PC (http://127.0.0.1:8787). The owner's app uses this
 *   PC's server by default only while «Сервер и сайт на этом компьютере» is on (the server laptop): a gaming PC signs
 *   in to raidos.app, where the owner's account lives. Only HTTPS or plain HTTP to localhost / 127.0.0.1 is accepted.
 * - The renderer can only reach the whitelisted paths below through `serviceRequest`.
 * - The account session token lives only here: it is encrypted with Electron `safeStorage` in userData and is
 *   never sent to the renderer, never logged. Login / logout / status have their own IPC (see main.ts).
 * - A server that is not running is reported as `ServiceUnavailableError`, so callers can fall back to local work.
 */
import { app, safeStorage } from 'electron'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildDefaultServerUrl, buildEntitlementKeys, isOwnerBuild } from './buildEdition.js'
import { localServerEnabled } from './localServer.js'
import { acceptIssued, clearEntitlement, deviceId, deviceName, entitlementFor, forgetServerKey, mayPinServerKeys, needsRefresh, pinServerKey, refuseEntitlement, takeDeviceNotice, trustedKey, type EftConflict, type EntitlementStatus } from './entitlement.js'
import { clearGameCache, type CacheAccess } from './gameDataCache.js'
import { restartingStatus, retriesWhileRestarting, retryWhileRestarting } from '../src/shared/sendRetry.js'

/** Paid data routes: sent with the session and this device's id (server/src/routes/data.ts); the live relay too (routes/live.ts). */
const GATED = /^\/v1\/(?:data|catalog|players|live)\//
/** The live relay's wait for the phone (GET /v1/live/:mode?since=): answered within ~25 s. */
const LIVE_WAIT = /^\/v1\/live\/[a-z]+\?since=/
/** «Онлайн сейчас»: the heartbeat goes with this device's id too, which tells the PC from the phone (server/src/routes/presence.ts). */
const PRESENCE_PATH = '/v1/me/presence'

export const DEFAULT_API_URL = 'http://127.0.0.1:8787'
const MODE = '(?:pvp|pve|seasonal)'

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
const ROUTES: Array<{ methods: Method[]; path: RegExp }> = [
  { methods: ['GET'], path: /^\/health$/ },
  // `v`: the version of the catalog the page already shows (its contentVersion): sent as If-None-Match, see below.
  { methods: ['GET'], path: new RegExp(`^/v1/catalog/${MODE}(?:\\?(?:lang=(?:ru|en)(?:&v=[a-f0-9]{40})?|v=[a-f0-9]{40}))?$`) },
  // Paid game data through the server only (server/src/routes/data.ts, docs/subscription-protection.md).
  { methods: ['POST'], path: /^\/v1\/data\/graphql$/ },
  { methods: ['GET'], path: /^\/v1\/data\/json\/(?:regular|pve|pvp-season)\/[a-z]{2,20}(?:_[a-z]{2})?$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/devices$/ },
  // Plans and prices for the paywall (public, server/src/routes/payments.ts).
  { methods: ['GET'], path: /^\/v1\/payments\/plans$/ },
  { methods: ['POST'], path: /^\/v1\/players\/resolve$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/players/${MODE}/\\d{1,12}$`) },
  { methods: ['POST'], path: /^\/v1\/sync\/events$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/goons/${MODE}$`) },
  // Bosses placed on the maps by the owner (server/src/routes/mapBosses.ts): everybody reads, only the owner's account writes.
  { methods: ['GET'], path: /^\/v1\/map-bosses$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/map-bosses(?:\/[a-f0-9]{24}\/remove|\/batch)?$/ },
  // Quest map points corrected by the owner (server/src/routes/questPoints.ts): everybody reads, only the owner's account writes.
  { methods: ['GET'], path: /^\/v1\/quest-points$/ },
  { methods: ['GET'], path: /^\/v1\/quest-texts$/ },
  // «Ивент-квесты» (server/src/routes/eventQuests.ts): everybody reads, only the owner's account writes.
  { methods: ['GET'], path: /^\/v1\/event-quests$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/event-quests$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/event-quests\/[A-Za-z0-9_-]{1,80}\/remove$/ },
  // Quest requirements curated by the owner (server/src/routes/questRequirements.ts): everybody reads, only the owner writes.
  { methods: ['GET'], path: /^\/v1\/quest-requirements$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/quest-requirements$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/quest-requirements\/(?:order|[a-f0-9]{24}\/remove)$/ },
  // «Правки карты сразу у всех»: waits up to ~25 s for the owner's next map correction (server/src/routes/mapUpdates.ts).
  { methods: ['GET'], path: /^\/v1\/map-updates(?:\?since=\d{1,16})?$/ },
  // The owner's notice over every app (server/src/routes/announcement.ts), waited for like the map updates.
  { methods: ['GET'], path: /^\/v1\/announcement(?:\?since=\d{1,16})?$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/announcement$/ },
  // The owner's minimap switch for every app (the same route file): read with the notice above, set by the owner.
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/features$/ },
  // «Админ панель» → «Блоки» (server/src/routes/overviewDefaults.ts): the Overview every player starts from. The apps read
  // it with the notice above; the owner keeps it here.
  { methods: ['GET'], path: /^\/v1\/overview-defaults$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/overview-defaults$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/overview-defaults\/reset$/ },
  // Friend requests, squad invitations and squad mates' progress at once (server/src/services/socialSignals.ts).
  { methods: ['GET'], path: /^\/v1\/me\/social-events(?:\?since=\d{1,16})?$/ },
  // «Онлайн сейчас» (src/sync/presence.ts): about once a minute while signed in; the owner app reads the count under «Ваши
  // предложения» (src/data/ownerOnline.ts). The server answers 404 to everybody but the owner.
  { methods: ['POST'], path: /^\/v1\/me\/presence$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/online$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/quest-points$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/quest-points\/[a-f0-9]{24}\/remove$/ },
  // The point constructor's photos (server/src/routes/questPoints.ts): the owner uploads one (base64, ≤ 5 MB); every
  // signed-in app reads the ones the points show, as base64 JSON.
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/quest-point-photos$/ },
  { methods: ['GET'], path: /^\/v1\/me\/quest-point-photos\/[a-f0-9]{24}$/ },
  { methods: ['GET', 'PUT'], path: /^\/v1\/accounts\/me\/admin\/quest-texts$/ },
  // «Заявки» (owner app, src/pages/RequestsPage.tsx): players' reports and quest corrections, the live count, the
  // screenshots as base64 JSON, close / reopen and «Начислить дни». The server answers 404 to everybody but the owner.
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/requests\/events(?:\?since=\d{1,16})?$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/online-stats\?days=\d{1,2}$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/bug-reports\?status=(?:open|closed)&limit=\d{1,3}$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/bug-reports\/\d{1,12}(?:\/files\/\d\/data)?$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/bug-reports\/\d{1,12}\/(?:status|reward)$/ },
  // «Доступ Claude к заявкам» (src/requests/ClaudeAccessPanel.tsx, server/src/routes/agentRequests.ts): the state of the
  // owner's read-only key, a new key (shown once) and revoking it. The reports read with the key never pass here.
  { methods: ['GET', 'POST', 'DELETE'], path: /^\/v1\/accounts\/me\/admin\/requests-key$/ },
  // «Чат с поддержкой» (server/src/routes/supportChat.ts): the player's conversation with the owner, and the owner's
  // «Заявки» → «Чаты» (the server answers 404 to everybody but the owner). DELETE: «Проблема решена» deletes the
  // conversation (owner, 14.10.2026).
  { methods: ['GET', 'POST'], path: /^\/v1\/me\/support\/messages(?:\?after=\d{1,12})?$/ },
  { methods: ['POST'], path: /^\/v1\/me\/support\/read$/ },
  // A chat screenshot (owner, 15.10.2026) as base64 JSON: the player's own conversation's, or any for the owner.
  { methods: ['GET'], path: /^\/v1\/me\/support\/attachments\/[a-f0-9]{24}$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/support\/attachments\/[a-f0-9]{24}$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/support\/threads(?:\?limit=\d{1,3}(?:&offset=\d{1,7})?)?$/ },
  { methods: ['GET', 'DELETE'], path: /^\/v1\/accounts\/me\/admin\/support\/threads\/[a-f0-9]{24}$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/support\/threads\/[a-f0-9]{24}\/(?:messages|read)$/ },
  // «Написать пользователю» (src/support/FindUserToWrite.tsx): accounts by part of the e-mail (owner only, 20 at most).
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/support\/search\?q=[A-Za-z0-9%._~!*'()-]{2,800}$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/quest-texts\/[a-f0-9]{24}\/remove$/ },
  { methods: ['POST'], path: new RegExp(`^/v1/goons/${MODE}/sightings$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/me/progress/${MODE}$`) },
  { methods: ['POST'], path: new RegExp(`^/v1/me/progress/${MODE}/events$`) },
  // «Престиж +» / a nickname change: the whole mode starts again (src/state/modeReset.ts, server/src/routes/me.ts).
  { methods: ['POST'], path: new RegExp(`^/v1/me/progress/${MODE}/reset$`) },
  // Story chapters and «Ручная отметка» of the mode (server/src/routes/me.ts; src/sync/serverSync.ts syncStory / syncManualMarks).
  { methods: ['GET', 'POST'], path: new RegExp(`^/v1/me/(?:story/${MODE}|progress/${MODE}/manual)$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/collector/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/hideout/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: new RegExp(`^/v1/me/quest-mirror/${MODE}$`) },
  { methods: ['GET', 'PUT'], path: /^\/v1\/me\/game-mode$/ },
  { methods: ['GET', 'POST'], path: new RegExp(`^/v1/me/position/${MODE}$`) },
  // «Моментально в телефоне» (server/src/routes/live.ts): the position and the recognised item for the phone of the
  // account; nothing is stored on the server. The PC publishes; reading is the phone's (and kept here for the owner's tests).
  { methods: ['POST'], path: new RegExp(`^/v1/live/${MODE}/(?:position|item)$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/live/${MODE}(?:\\?since=\\d{1,16})?$`) },
  // Objective progress and its history (server/src/routes/me.ts).
  { methods: ['GET'], path: new RegExp(`^/v1/me/objectives/${MODE}$`) },
  { methods: ['POST'], path: new RegExp(`^/v1/me/objectives/${MODE}/(?:sync|events/[A-Za-z0-9_-]{6,80}/undo)$`) },
  { methods: ['GET', 'PUT'], path: /^\/v1\/me\/settings$/ },
  { methods: ['GET'], path: /^\/v1\/me\/summary$/ },
  // «Информация о друге»: this app's own level in each mode, for the player's friends (src/squad/useShareLevels.ts).
  { methods: ['PUT'], path: /^\/v1\/me\/levels$/ },
  // Account: nicknames per mode, approving a website QR sign-in (services/loginCodes.ts on the server).
  { methods: ['GET'], path: /^\/v1\/accounts\/me$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/nicknames$/ },
  // «Объявления по регионам» and «Опросы» (server/src/routes/notices.ts, src/notices/noticeInbox.ts): this account's
  // popups, «Понятно», «Позже», the answers and the photos (base64 JSON).
  { methods: ['GET'], path: /^\/v1\/me\/notices$/ },
  { methods: ['POST'], path: /^\/v1\/me\/notices\/\d{1,12}\/(?:seen|close)$/ },
  { methods: ['GET'], path: /^\/v1\/me\/notices\/\d{1,12}\/images\/\d$/ },
  { methods: ['POST'], path: /^\/v1\/me\/surveys\/\d{1,12}\/(?:later|responses)$/ },
  // The owner's «Объявления по регионам» / «Опросы» (src/notices/OwnerNoticesPanel.tsx; 404 for everybody but the owner).
  { methods: ['GET', 'POST'], path: /^\/v1\/accounts\/me\/admin\/notices(?:\?kind=(?:announcement|survey))?$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/notices\/images$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/notices\/\d{1,12}\/withdraw$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/notices\/\d{1,12}\/images\/\d$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/admin\/surveys$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/admin\/surveys\/\d{1,12}\/results$/ },
  // «Укажите страну» (src/account/CountryGate.tsx): the country of an account without one, once (server: 409 after).
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/initial-country$/ },
  // «Пригласи друга»: the Escape from Tarkov AccountId read from the game logs (one game account — one Raid OS account).
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/eft-account$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/qr-login\/(?:inspect|approve)$/ },
  // Phone number and SMS codes (server/src/routes/phone.ts). Only the code *requests* go through here: the calls that
  // return a session (/phone/login, /phone/reset) have their own IPC, so the token never reaches the renderer.
  { methods: ['GET'], path: /^\/v1\/accounts\/auth-config$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/phone\/(?:login|reset)\/start$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/phone\/(?:start|confirm|remove)$/ },
  // E-mail codes (server/src/routes/email.ts): the same split — sign-in / reset by code has its own IPC.
  { methods: ['POST'], path: /^\/v1\/accounts\/email\/(?:login|reset)\/start$/ },
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/email\/(?:start|confirm)$/ },
  // Registration in the app: only «Отправить код ещё раз» (answers a new challenge, never a session) goes through here.
  // POST /register and /register/confirm return a session, so they have their own IPC (accountRegister below).
  { methods: ['POST'], path: /^\/v1\/accounts\/register\/resend$/ },
  // The accepted version of the legal documents after registration (152-ФЗ: the consent must be provable).
  { methods: ['POST'], path: /^\/v1\/accounts\/me\/consents$/ },
  // «Сообщить об ошибке» (server/src/routes/bugReports.ts): signed-in accounts only, screenshots in base64 (≤ 25 MB).
  { methods: ['POST'], path: /^\/v1\/bug-reports$/ },
  // «Кабинет стримера» (server/src/routes/accounts.ts, payouts.ts): statistics, audience links, payouts.
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-stats\?period=(?:day|month|year)$/ },
  { methods: ['GET'], path: /^\/v1\/accounts\/me\/referral-campaigns$/ },
  { methods: ['GET', 'POST'], path: /^\/v1\/accounts\/me\/payouts$/ },
  { methods: ['PUT'], path: /^\/v1\/accounts\/me\/payout-settings$/ },
  // «Отряд» (server/src/routes/squads.ts): the server checks membership on every call.
  { methods: ['GET'], path: new RegExp(`^/v1/squads/mine/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/squads(?:\/join)?$/ },
  { methods: ['GET'], path: new RegExp(`^/v1/squads/[a-f0-9]{32}/overview/${MODE}$`) },
  { methods: ['POST'], path: /^\/v1\/squads\/[a-f0-9]{32}\/(?:invites|leave|disband|kick|invite-friend)$/ },
  { methods: ['POST'], path: /^\/v1\/squads\/invitations\/[a-f0-9]{24}\/(?:accept|decline)$/ },
  // «Топ сборок» (server/src/routes/buildCatalog.ts): published weapon builds and their likes, signed-in accounts only.
  { methods: ['GET'], path: /^\/v1\/builds\?mode=(?:pvp|pve|seasonal)(?:&weapon=[a-f0-9]{24})?(?:&sort=(?:top|new))?(?:&offset=\d{1,6})?$/ },
  { methods: ['POST'], path: /^\/v1\/builds$/ },
  { methods: ['POST'], path: /^\/v1\/builds\/[a-f0-9]{24}\/(?:like|remove)$/ },
  // Friends (server/src/routes/friends.ts): the server checks the friendship on every call.
  { methods: ['GET'], path: /^\/v1\/friends$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/(?:requests|code)$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/requests\/[a-f0-9]{24}\/(?:accept|decline|cancel)$/ },
  { methods: ['POST'], path: /^\/v1\/friends\/[a-f0-9]{24}\/(?:remove|block|unblock)$/ },
  { methods: ['PUT'], path: /^\/v1\/friends\/[a-f0-9]{24}\/privacy$/ },
  // A friend's level and prestige per mode (the info button in «Друзья»).
  { methods: ['GET'], path: /^\/v1\/friends\/[a-f0-9]{24}\/info$/ },
  { methods: ['POST'], path: new RegExp(`^/v1/friends/progress/${MODE}$`) },
  { methods: ['GET'], path: new RegExp(`^/v1/friends/needs/${MODE}$`) },
]

export class ServiceUnavailableError extends Error {
  /** `notTaken`: the server never got the request (no connection, or a proxy's 502–504 in front of a stopped server). */
  constructor(readonly notTaken = false) { super('Сервер недоступен') }
}

export function isServiceUnavailable(error: unknown) {
  return error instanceof ServiceUnavailableError
}

/** Server address typed in the app (Profile → server account), e.g. the owner's public link; '' = default. */
let savedServerUrl = ''
let serverUrlLoaded = false
const serverUrlFile = () => join(app.getPath('userData'), 'server-url.json')

function checkServerUrl(raw: string) {
  const url = new URL(raw)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Для сервера требуется HTTPS')
  return raw
}

/** Owner build with the local server mode on: this PC's server is the default instead of the build's address. */
let localPreferred = false
let localCheckedAt = 0
async function refreshLocalPreference() {
  if (!isOwnerBuild() || !buildDefaultServerUrl()) { localPreferred = false; return }
  if (Date.now() - localCheckedAt < 3000) return
  localCheckedAt = Date.now()
  localPreferred = await localServerEnabled().catch(() => false)
}

/** The local server mode was switched: decide the default server again on the next request. */
export function forgetLocalPreference() {
  localCheckedAt = 0
}

/**
 * Which saved server addresses this app accepts. The owner's app: any (HTTPS or this PC). The players' app: only the
 * default ('') or a server whose entitlement key is built into the exe — a self-made server could never unlock it anyway
 * (electron/entitlement.ts), and the address cannot be changed from the players' interface.
 */
export function serverUrlAllowed(url: string) {
  if (!url || isOwnerBuild()) return true
  try { return new URL(url).origin === url && url in buildEntitlementKeys() } catch { return false }
}

export async function loadServerUrl() {
  await refreshLocalPreference()
  if (serverUrlLoaded) return savedServerUrl
  serverUrlLoaded = true
  try {
    const value = (JSON.parse(await readFile(serverUrlFile(), 'utf8')) as { url?: unknown }).url
    savedServerUrl = typeof value === 'string' ? checkServerUrl(value.trim().replace(/\/+$/, '')) : ''
    // An address saved by an older version of the players' app (any server, trusted on first use) is not used any more.
    if (!serverUrlAllowed(savedServerUrl)) savedServerUrl = ''
  } catch {
    savedServerUrl = ''
  }
  return savedServerUrl
}

/** Saves another server address; the session of the previous server is dropped (accounts live per server). */
export async function setServerUrl(raw: unknown) {
  const value = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : ''
  const next = value ? checkServerUrl(value.includes('://') ? value : `https://${value}`) : ''
  if (!serverUrlAllowed(next)) throw new Error('В приложении для игроков адрес сервера не меняется')
  if (next !== savedServerUrl) await clearSession().catch(() => {})
  savedServerUrl = next
  serverUrlLoaded = true
  await writeFile(serverUrlFile(), JSON.stringify({ url: next }), 'utf8')
  return accountStatus()
}

/**
 * The address this build connects to by default: TARKOV_DEFAULT_SERVER_URL at build time (https://raidos.app), else
 * this PC. The owner's app with the local server mode on (the server laptop) uses this PC's server.
 */
export function defaultApiUrl() {
  if (localPreferred) return DEFAULT_API_URL
  return buildDefaultServerUrl() || DEFAULT_API_URL
}

export function apiBaseUrl() {
  return checkServerUrl((process.env.TARKOV_API_URL?.trim() || savedServerUrl || defaultApiUrl()).replace(/\/+$/, ''))
}

export const isLocalAddress = (url: string) => {
  try { return ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) } catch { return true }
}

// --------------------------------------------------------------------------------------------------------------
// Session (main process only)
// --------------------------------------------------------------------------------------------------------------

/** `server`: the API the session belongs to (accounts live per server); older saved sessions have none. */
interface StoredAccount { email: string; kind: 'user' | 'streamer'; server?: string }
let sessionToken: string | null = null
let account: StoredAccount | null = null
let loaded = false

const tokenFile = () => join(app.getPath('userData'), 'server-session.bin')
const accountFile = () => join(app.getPath('userData'), 'server-account.json')

/** A real OS-backed encryption (DPAPI on Windows, Keychain on macOS, a keyring on Linux). */
function canPersistToken() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

async function loadSession() {
  if (loaded) return
  loaded = true
  try {
    const parsed = JSON.parse(await readFile(accountFile(), 'utf8')) as Partial<StoredAccount>
    if (typeof parsed.email === 'string') account = { email: parsed.email, kind: parsed.kind === 'streamer' ? 'streamer' : 'user', ...(typeof parsed.server === 'string' ? { server: parsed.server } : {}) }
  } catch { /* not signed in */ }
  if (!canPersistToken()) return
  try {
    const token = safeStorage.decryptString(await readFile(tokenFile()))
    if (/^[A-Za-z0-9_-]{20,200}$/.test(token)) sessionToken = token
  } catch { /* no stored session or it cannot be decrypted on this machine */ }
  if (!sessionToken) account = null
}

/**
 * The session is only sent to the server it was made on: after the server address changes (another saved address,
 * or the local server mode switched off on a gaming PC) the old session is dropped instead of being sent elsewhere.
 */
async function loadSessionForServer() {
  await loadServerUrl()
  await loadSession()
  if (!sessionToken || !account?.server) return
  let base: string
  try { base = apiBaseUrl() } catch { return }
  if (account.server !== base) await clearSession()
}

/** «raidos.app» or «этот компьютер (127.0.0.1:8787)»: which server a message is about. */
function serverName(url: string) {
  try {
    const parsed = new URL(url)
    return isLocalAddress(url) ? `этот компьютер (${parsed.host})` : parsed.host
  } catch {
    return url
  }
}

async function saveSession(token: string, next: StoredAccount) {
  // A new session (not just an updated e-mail / kind): ask for the entitlement right away.
  if (token !== sessionToken || !account) entitlementDue = true
  sessionToken = token
  let server = next.server
  try { server = apiBaseUrl() } catch { /* keep */ }
  account = { ...next, ...(server ? { server } : {}) }
  next = account
  loaded = true
  await writeFile(accountFile(), JSON.stringify(next), 'utf8').catch(() => {})
  // Without OS encryption the token stays in memory only: the user signs in again after a restart.
  if (canPersistToken()) await writeFile(tokenFile(), safeStorage.encryptString(token)).catch(() => {})
}

async function clearSession() {
  sessionToken = null
  account = null
  loaded = true
  await rm(tokenFile(), { force: true }).catch(() => {})
  await rm(accountFile(), { force: true }).catch(() => {})
  // No account, no paid data on this PC (docs/subscription-protection.md).
  await clearEntitlement()
  await clearGameCache()
}

// --------------------------------------------------------------------------------------------------------------
// HTTP
// --------------------------------------------------------------------------------------------------------------

async function send(method: Method, path: string, options: { body?: unknown; token?: string | null; timeoutMs?: number; device?: string; headers?: Record<string, string> } = {}) {
  await loadServerUrl()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
      headers: { accept: 'application/json', 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.device ? { 'x-raid-device': options.device } : {}), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    // a timed-out request may have reached the server; anything else never left this PC
    throw new ServiceUnavailableError(!(error instanceof Error && error.name === 'TimeoutError'))
  }
  // 204 No Content and 304 Not Modified carry no body (and no content type).
  const empty = response.status === 204 || response.status === 304
  if (!empty && !response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw new ServiceUnavailableError(restartingStatus(response.status))
  }
  const result = empty ? null : await response.json().catch(() => null) as { error?: string } | null
  return { response, result }
}

/**
 * The catalog (GET /v1/catalog/:mode) is asked again only for what changed. The server's ETag (server/src/app.ts: a
 * hash of the content) goes to the page as the catalog's `metadata.contentVersion`; the page sends it back as `v=`
 * and the request carries it as If-None-Match. While the catalog is the same the server answers an empty 304 and the
 * page gets `{ notModified: true }`: no download, no parse here, no copy of the whole catalog to the page, no rewrite
 * of its encrypted cache (src/data/tarkovJsonClient.ts). A server that sends no such ETag gets plain requests.
 */
const CATALOG_PATH = /^\/v1\/catalog\//
const CATALOG_VERSION = /^W\/"([a-f0-9]{40})"$/

export function catalogRequest(path: string): { path: string; headers?: Record<string, string> } {
  if (!CATALOG_PATH.test(path)) return { path }
  const [route, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  const version = params.get('v')
  params.delete('v')
  const rest = params.toString()
  return { path: rest ? `${route}?${rest}` : route!, ...(version ? { headers: { 'if-none-match': `W/"${version}"` } } : {}) }
}

function withCatalogVersion(result: unknown, etag: string | null) {
  const version = etag ? CATALOG_VERSION.exec(etag)?.[1] : undefined
  const metadata = result && typeof result === 'object' ? (result as { metadata?: unknown }).metadata : undefined
  if (version && metadata && typeof metadata === 'object') (metadata as { contentVersion?: string }).contentVersion = version
  return result
}

/** A support chat message may carry screenshots (up to ~28 MB): it gets the bug report's time to upload. */
const SUPPORT_MESSAGE_PATH = /^\/v1\/(?:me\/support\/messages|accounts\/me\/admin\/support\/threads\/[a-f0-9]{24}\/messages)$/

/** Whitelisted request from the renderer. `/v1/me/*` returns null when no account is signed in. */
export async function serviceRequest(method: string, path: string, body?: unknown): Promise<unknown | null> {
  const route = ROUTES.find((entry) => entry.path.test(String(path)))
  if (!route || !route.methods.includes(method as Method)) throw new Error('Неизвестный запрос сервиса')
  const personal = path.startsWith('/v1/me/') || /^\/v1\/(?:squads|friends|bug-reports|builds)(?:[/?]|$)/.test(path) || /^\/v1\/accounts\/me(?:[/?]|$)/.test(path)
  await loadSessionForServer()
  if (personal && !sessionToken) return null
  // The development sync endpoint keeps its device token; everything else uses the signed-in account.
  const token = path === '/v1/sync/events' ? process.env.TARKOV_API_TOKEN ?? null : sessionToken
  const gated = GATED.test(path)
  const catalog = catalogRequest(path)
  // A support message, bug report or idea is sent again while the server restarts (src/shared/sendRetry.ts).
  const request = async () => send(method as Method, catalog.path, { body, token, headers: catalog.headers, timeoutMs: LIVE_WAIT.test(path) ? 45_000 : gated ? 60_000 : path === '/v1/bug-reports' || (method === 'POST' && SUPPORT_MESSAGE_PATH.test(path)) ? 180_000 : path === '/v1/accounts/me/admin/notices/images' || path === '/v1/accounts/me/admin/quest-point-photos' ? 60_000 : path.startsWith('/v1/map-updates') || path.startsWith('/v1/announcement') || path.startsWith('/v1/me/social-events') || path.startsWith('/v1/accounts/me/admin/requests/events') ? 45_000 : 15_000, ...(gated || path === PRESENCE_PATH ? { device: await deviceId() } : {}) })
  const { response, result } = retriesWhileRestarting(method, path)
    ? await retryWhileRestarting(request, (error) => error instanceof ServiceUnavailableError && error.notTaken)
    : await request()
  if (response.status === 401 && (personal || (gated && sessionToken))) {
    await clearSession()
    throw new Error('Сессия истекла. Войдите в аккаунт сервера снова.')
  }
  if (gated && (response.status === 402 || response.status === 403)) await refusedByServer(response.status, result)
  // The game account of this PC was reported (src/account/EftAccountBinding.tsx): the server may now refuse or allow this
  // device (one game account — one Raid OS account), so the next status asks for the entitlement at once.
  if (path === EFT_ACCOUNT_PATH && method === 'POST') entitlementDue = true
  if (response.status === 304 && catalog.headers) return { notModified: true }
  if (!response.ok) throw new Error(result?.error ?? `Сервис недоступен: ${response.status}`)
  return CATALOG_PATH.test(path) ? withCatalogVersion(result, response.headers.get('etag')) : result
}

const EFT_ACCOUNT_PATH = '/v1/accounts/me/eft-account'
const MASKED_EFT = /^••••\d{1,3}$/

/** The server's eft_conflict answer, shape-checked (AccountStore.eftConflictBody). */
function eftConflictOf(result: unknown): EftConflict | undefined {
  const body = result && typeof result === 'object' ? result as { conflict?: unknown; seen?: unknown; bound?: unknown } : {}
  if (body.conflict !== 'in-use' && body.conflict !== 'other-account') return undefined
  const masked = (value: unknown) => (typeof value === 'string' && MASKED_EFT.test(value) ? value : undefined)
  const seen = masked(body.seen)
  const bound = masked(body.bound)
  return { conflict: body.conflict, ...(seen ? { seen } : {}), ...(bound ? { bound } : {}) }
}

/** 402 / 403 from a paid route: the entitlement and the encrypted cache go at once (the app shows the paywall). */
async function refusedByServer(status: number, result: { error?: string; code?: unknown } | null) {
  const code = result?.code
  if (status === 402) await refuseEntitlement('subscription', result?.error)
  else if (code === 'device_revoked' || code === 'device_inactive') await refuseEntitlement(code === 'device_revoked' ? 'device-revoked' : 'device-inactive', result?.error)
  else if (code === 'eft_conflict') await refuseEntitlement('eft-conflict', result?.error, eftConflictOf(result))
  else return
  await clearGameCache()
}

// --------------------------------------------------------------------------------------------------------------
// Entitlement (client edition paywall, electron/entitlement.ts)
// --------------------------------------------------------------------------------------------------------------

let refreshing: Promise<EntitlementStatus> | null = null

/**
 * The signed entitlement of the signed-in account for this device: renewed from the server when missing or older than
 * three hours (or `force`, right after sign-in); offline the stored token keeps working until it expires (≤ 72 h).
 */
export function refreshEntitlement(force = false): Promise<EntitlementStatus> {
  refreshing ??= doRefreshEntitlement(force).finally(() => { refreshing = null })
  return refreshing
}

async function doRefreshEntitlement(force: boolean): Promise<EntitlementStatus> {
  await loadSessionForServer()
  if (!sessionToken) return { valid: false, reason: 'signed-out' }
  let server: string
  try { server = apiBaseUrl() } catch { return { valid: false, reason: 'unavailable' } }
  if (!force && !(await needsRefresh(server))) return entitlementFor(server)
  try {
    // A server without a built-in or pinned key: the owner's app pins the one it serves (trust on first use).
    if (!(await trustedKey(server))) {
      // The players' app trusts only keys built into it: nothing to ask this server for.
      if (!mayPinServerKeys(server)) return { valid: false, reason: 'no-key' }
      const served = await send('GET', '/v1/entitlement/public-key', { timeoutMs: 8000 })
      const pinned = await pinServerKey(server, (served.result as { publicKey?: unknown } | null)?.publicKey)
      if (!pinned.ok) return { valid: false, reason: pinned.reason }
    }
    const { response, result } = await send('POST', '/v1/entitlement', { token: sessionToken, timeoutMs: 10_000, body: { deviceId: await deviceId(), deviceName: deviceName() } })
    if (response.status === 401) { await clearSession(); return { valid: false, reason: 'signed-out' } }
    if (response.status === 402) {
      await refuseEntitlement('subscription', (result as { error?: string } | null)?.error)
      await clearGameCache()
      return { ...(await entitlementFor(server)), revokedDevices: takeDeviceNotice() }
    }
    // One game account — one Raid OS account: the game account in this PC's logs breaks it (the app shows why).
    if (response.status === 403 && (result as { code?: unknown } | null)?.code === 'eft_conflict') {
      await refuseEntitlement('eft-conflict', (result as { error?: string } | null)?.error, eftConflictOf(result))
      await clearGameCache()
      return entitlementFor(server)
    }
    if (response.ok) {
      const status = await acceptIssued(server, result)
      // A key that no longer matches (the server's key changed): say so instead of «no subscription».
      if (!status.valid && status.reason === 'key-mismatch') { await refuseEntitlement('key-mismatch'); await clearGameCache() }
      return status
    }
  } catch { /* offline: the stored token below */ }
  return entitlementFor(server)
}

/** The encrypted cache's scope and lifetime (electron/gameDataCache.ts): only with a valid entitlement. */
export async function gameCacheAccess(): Promise<CacheAccess | null> {
  await loadSessionForServer()
  if (!sessionToken || !account) return null
  let server: string
  try { server = apiBaseUrl() } catch { return null }
  const status = await entitlementFor(server)
  if (!status.valid || !status.expiresAt) return null
  return { scope: `${server}|${account.email}`, expiresAt: Date.parse(status.expiresAt) }
}

/** For main-process callers that have a local fallback: null when the server is not reachable. */
export async function serviceRequestOrNull(method: string, path: string, body?: unknown) {
  try {
    return await serviceRequest(method, path, body)
  } catch (error) {
    if (isServiceUnavailable(error)) return null
    throw error
  }
}

export type AccountMode = 'pvp' | 'pve' | 'seasonal'
export interface AccountSubscription { status: 'active' | 'trial' | 'inactive' | 'lifetime'; paidUntil?: string; trialEndsAt?: string; trialPendingDays?: number }

export interface AccountStatus {
  signedIn: boolean
  email?: string
  kind?: 'user' | 'streamer'
  /** From the server account (GET /v1/accounts/me) while online. */
  nicknames?: Partial<Record<AccountMode, string>>
  subscription?: AccountSubscription
  /** Verified phone number, masked by the server. */
  phone?: string
  /** false: the e-mail is not confirmed yet («Подтвердите e-mail»); absent with an older server. */
  emailVerified?: boolean
  /** When the account was registered (ISO): the renderer's first-run guide is for new accounts. */
  createdAt?: string
  online: boolean
  serverUrl: string
  /** false when the OS offers no secure storage: the session is kept only until the app closes. */
  persistent: boolean
  /** Signed entitlement of this device (electron/entitlement.ts): the players' app shows the paywall without it. */
  entitlement?: EntitlementStatus
}

export async function accountStatus(): Promise<AccountStatus> {
  await loadSessionForServer()
  let serverUrl = defaultApiUrl()
  let online: boolean
  let details: Pick<AccountStatus, 'nicknames' | 'subscription' | 'phone' | 'emailVerified' | 'createdAt'> = {}
  try {
    serverUrl = apiBaseUrl()
    const health = await send('GET', '/health', { timeoutMs: 3000 })
    online = health.response.ok
    if (online && sessionToken) {
      const me = await send('GET', '/v1/accounts/me', { token: sessionToken, timeoutMs: 5000 })
      if (me.response.status === 401) await clearSession()
      else if (me.response.ok && me.result && typeof (me.result as { email?: unknown }).email === 'string') {
        const view = me.result as { email: string; kind?: string; nicknames?: unknown; subscription?: unknown; phone?: unknown; emailVerifiedAt?: unknown; createdAt?: unknown }
        const next: StoredAccount = { email: view.email, kind: view.kind === 'streamer' ? 'streamer' : 'user' }
        if (next.email !== account?.email || next.kind !== account?.kind) await saveSession(sessionToken, next)
        details = accountDetails(view)
      }
    }
  } catch { online = false }
  // After a sign-in the entitlement is asked for at once; otherwise it is renewed every few hours (offline: the stored one).
  const force = entitlementDue
  entitlementDue = false
  let entitlement: EntitlementStatus = { valid: false, reason: 'signed-out' }
  if (sessionToken) {
    try { entitlement = online ? await refreshEntitlement(force) : await entitlementFor(serverUrl) } catch { entitlement = { valid: false, reason: 'unavailable' } }
  }
  const notice = takeDeviceNotice() ?? entitlement.revokedDevices
  return { signedIn: Boolean(sessionToken), ...(account && sessionToken ? { email: account.email, kind: account.kind, ...details } : {}), online, serverUrl, persistent: canPersistToken(), entitlement: { ...entitlement, ...(notice?.length ? { revokedDevices: notice } : {}) } }
}

/** Set by a fresh sign-in: the next status asks the server for the entitlement right away. */
let entitlementDue = false

const NICKNAME = /^[a-zA-Z0-9_-]{3,15}$/

/** Only the fields the app shows, shape-checked (the server is trusted, the network is not). */
function accountDetails(view: { nicknames?: unknown; subscription?: unknown; phone?: unknown; emailVerifiedAt?: unknown; createdAt?: unknown }): Pick<AccountStatus, 'nicknames' | 'subscription' | 'phone' | 'emailVerified' | 'createdAt'> {
  const nicknames: Partial<Record<AccountMode, string>> = {}
  const raw = view.nicknames && typeof view.nicknames === 'object' ? view.nicknames as Record<string, unknown> : {}
  for (const mode of ['pvp', 'pve', 'seasonal'] as const) {
    const value = raw[mode]
    if (typeof value === 'string' && NICKNAME.test(value)) nicknames[mode] = value
  }
  const sub = view.subscription && typeof view.subscription === 'object' ? view.subscription as Record<string, unknown> : {}
  // Streamers use the service free of charge for good: { status: 'active', lifetime: true } on the server.
  const status = sub.lifetime === true ? 'lifetime' : ['active', 'trial', 'inactive'].includes(String(sub.status)) ? sub.status as AccountSubscription['status'] : 'inactive'
  const date = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined)
  const paidUntil = date(sub.paidUntil)
  const trialEndsAt = date(sub.trialEndsAt)
  // The free period waiting for the first sign-in in an app: its length in days.
  const pending = typeof sub.trialPendingDays === 'number' && Number.isFinite(sub.trialPendingDays) && sub.trialPendingDays > 0 ? sub.trialPendingDays : undefined
  // The verified phone number comes masked from the server (+7 ••• •••-45-67).
  const masked = view.phone && typeof view.phone === 'object' ? (view.phone as { masked?: unknown }).masked : undefined
  const phone = typeof masked === 'string' && /^[+\d •-]{5,32}$/.test(masked) ? masked : undefined
  const createdAt = date(view.createdAt)
  return {
    nicknames,
    subscription: { status, ...(paidUntil ? { paidUntil } : {}), ...(trialEndsAt ? { trialEndsAt } : {}), ...(pending ? { trialPendingDays: pending } : {}) },
    ...(phone ? { phone } : {}), emailVerified: date(view.emailVerifiedAt) !== undefined, ...(createdAt ? { createdAt } : {}),
  }
}

/**
 * «Войти в мобильную версию»: a one-time code for the phone app (POST /v1/accounts/me/login-codes, two minutes, works
 * once). The session token itself never leaves this process; only the short-lived code goes into the QR code.
 */
export async function createMobileLoginCode(): Promise<{ code: string; expiresAt: string }> {
  await loadSessionForServer()
  if (!sessionToken) throw new Error('Сначала войдите в аккаунт')
  const { response, result } = await send('POST', '/v1/accounts/me/login-codes', { token: sessionToken, timeoutMs: 8000 })
  if (response.status === 401) { await clearSession(); throw new Error('Сессия истекла. Войдите в аккаунт снова.') }
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Сервер не создал код: ${response.status}`)
  const answer = result as { code?: unknown; expiresAt?: unknown } | null
  if (typeof answer?.code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(answer.code) || typeof answer.expiresAt !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  return { code: answer.code, expiresAt: answer.expiresAt }
}

/**
 * The owner's copy only (electron/appUpdate.ts): the signed manifest of the whole owner exe
 * (GET /v1/accounts/me/admin/server-exe-manifest, server/src/routes/serverDownload.ts), asked with the owner's session,
 * which never leaves this process. The caller checks the signature. null: a player's copy (never asks), not signed in,
 * not the owner, nothing published, or offline.
 */
export async function ownerExeManifest(): Promise<unknown> {
  if (!isOwnerBuild()) return null
  try {
    await loadSessionForServer()
    if (!sessionToken) return null
    const { response, result } = await send('GET', '/v1/accounts/me/admin/server-exe-manifest', { token: sessionToken, timeoutMs: 10_000 })
    return response.ok ? result : null
  } catch {
    return null
  }
}

const SIGN_IN_FOR_UPDATE = 'Войдите в аккаунт владельца, чтобы скачать обновление'

/**
 * The owner's copy only: a one-time link to the whole owner exe (POST /v1/accounts/me/admin/server-exe-link: 15 minutes,
 * three downloads) on the server the session belongs to, and the size the server reports. Throws with the reason.
 */
export async function ownerExeLink(): Promise<{ url: string; size: number }> {
  if (!isOwnerBuild()) throw new Error('Не найдено')
  await loadSessionForServer()
  if (!sessionToken) throw new Error(SIGN_IN_FOR_UPDATE)
  const { response, result } = await send('POST', '/v1/accounts/me/admin/server-exe-link', { token: sessionToken, timeoutMs: 15_000 })
  if (response.status === 401) throw new Error(SIGN_IN_FOR_UPDATE)
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Сервер не отдал файл: HTTP ${response.status}`)
  const answer = result as { url?: unknown; size?: unknown } | null
  if (typeof answer?.url !== 'string' || !/^\/v1\/server-exe\/[a-f0-9]{48}$/.test(answer.url) || typeof answer.size !== 'number') throw new Error('Сервер вернул неожиданный ответ')
  return { url: `${apiBaseUrl()}${answer.url}`, size: answer.size }
}

export async function accountLogin(rawEmail: unknown, rawPassword: unknown): Promise<AccountStatus> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  await loadServerUrl()
  const server = serverName(apiBaseUrl())
  let sent: Awaited<ReturnType<typeof send>>
  try {
    sent = await send('POST', '/v1/accounts/login', { body: { email, password } })
  } catch (error) {
    if (isServiceUnavailable(error)) throw new Error(`Сервер ${server} недоступен. Проверьте интернет или адрес сервера.`, { cause: error })
    throw error
  }
  const { response, result } = sent
  // The short answer only (owner, 13.10.2026: «много лишнего текста»); the server never says whether an e-mail exists.
  if (response.status === 401) throw new Error('Неверный e-mail или пароль')
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token)) throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: typeof answer.account?.email === 'string' ? answer.account.email : email, kind: answer.account?.kind === 'streamer' ? 'streamer' : 'user' })
  return accountStatus()
}

/**
 * Sign-in by phone, or a password reset by phone, after the SMS code (POST /v1/accounts/phone/login | /phone/reset).
 * The code request itself goes through `serviceRequest`; this call returns a session, so it stays in this process.
 */
export function accountPhoneSignIn(kind: unknown, rawChallenge: unknown, rawCode: unknown, rawPassword?: unknown): Promise<AccountStatus> {
  return accountCodeSignIn('phone', kind, rawChallenge, rawCode, rawPassword)
}

/** The same after an e-mail code (POST /v1/accounts/email/login | /email/reset, server/src/routes/email.ts). */
export function accountEmailSignIn(kind: unknown, rawChallenge: unknown, rawCode: unknown, rawPassword?: unknown): Promise<AccountStatus> {
  return accountCodeSignIn('email', kind, rawChallenge, rawCode, rawPassword)
}

async function accountCodeSignIn(channel: 'phone' | 'email', kind: unknown, rawChallenge: unknown, rawCode: unknown, rawPassword?: unknown): Promise<AccountStatus> {
  const challengeId = typeof rawChallenge === 'string' ? rawChallenge : ''
  const code = typeof rawCode === 'string' ? rawCode.replace(/[\s-]/g, '') : ''
  if (!/^[A-Za-z0-9_-]{32}$/.test(challengeId)) throw new Error('Запросите код ещё раз')
  if (!/^\d{6}$/.test(code)) throw new Error(channel === 'phone' ? 'Код из SMS — 6 цифр' : 'Код из письма — 6 цифр')
  const reset = kind === 'reset'
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  if (reset && (password.length < 8 || password.length > 128)) throw new Error('Новый пароль: от 8 до 128 символов')
  await loadServerUrl()
  let sent: Awaited<ReturnType<typeof send>>
  try {
    sent = await send('POST', `/v1/accounts/${channel}/${reset ? 'reset' : 'login'}`, { body: reset ? { challengeId, code, password } : { challengeId, code } })
  } catch (error) {
    if (isServiceUnavailable(error)) throw new Error(`Сервер ${serverName(apiBaseUrl())} недоступен. Проверьте интернет или адрес сервера.`, { cause: error })
    throw error
  }
  const { response, result } = sent
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось войти: ${response.status}`)
  const answer = result as { token?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return accountStatus()
}

/** POST /v1/accounts/register while the server sends e-mail codes: no account yet, the code from the e-mail follows. */
export interface PendingRegistration { challengeId: string; expiresAt: string; resendSeconds: number; message: string }
export type RegistrationResult = { pending: PendingRegistration } | { status: AccountStatus; referralApplied: boolean }

const CHALLENGE_ID = /^[A-Za-z0-9_-]{32}$/
const REFERRAL_CODE = /^[a-zA-Z0-9_-]{3,24}$/
/** An ISO 3166-1 alpha-2 shape; the server checks the code against its list (src/shared/countries.ts). */
const COUNTRY_CODE = /^[A-Z]{2}$/

/** A session answer ({ token, account }) of the server: kept in this process, only the status goes back. */
async function adoptSessionAnswer(result: unknown) {
  const answer = result as { token?: unknown; referralApplied?: unknown; account?: { email?: unknown; kind?: unknown } } | null
  if (typeof answer?.token !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(answer.token) || typeof answer.account?.email !== 'string') throw new Error('Сервер вернул неожиданный ответ')
  await saveSession(answer.token, { email: answer.account.email, kind: answer.account.kind === 'streamer' ? 'streamer' : 'user' })
  return { status: await accountStatus(), referralApplied: answer.referralApplied === true }
}

async function sendAccountRequest(path: string, body: unknown) {
  await loadServerUrl()
  try {
    return await send('POST', path, { body })
  } catch (error) {
    if (isServiceUnavailable(error)) throw new Error(`Сервер ${serverName(apiBaseUrl())} недоступен. Проверьте интернет или адрес сервера.`, { cause: error })
    throw error
  }
}

/**
 * Registration in the app (POST /v1/accounts/register). With e-mail codes on the server answers 202 for every address
 * and the account appears only after the code (accountRegisterConfirm); otherwise 201 with a session, kept here.
 * `rawCountry`: the country of the form (owner, 13.10.2026: «при регистрации нужно указать страну»).
 */
export async function accountRegister(rawEmail: unknown, rawPassword: unknown, rawReferral?: unknown, rawCountry?: unknown): Promise<RegistrationResult> {
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : ''
  const password = typeof rawPassword === 'string' ? rawPassword : ''
  const referralCode = typeof rawReferral === 'string' ? rawReferral.trim() : ''
  const country = typeof rawCountry === 'string' ? rawCountry.trim().toUpperCase() : ''
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Введите корректный e-mail')
  if (password.length < 8 || password.length > 128) throw new Error('Пароль: от 8 до 128 символов')
  if (referralCode && !REFERRAL_CODE.test(referralCode)) throw new Error('Код приглашения: 3–24 символа, латиница, цифры, «_» или «-».')
  if (country && !COUNTRY_CODE.test(country)) throw new Error('Выберите страну из списка')
  const { response, result } = await sendAccountRequest('/v1/accounts/register', { email, password, ...(referralCode ? { referralCode } : {}), ...(country ? { country } : {}) })
  if (response.status === 202) {
    const pending = result as { challengeId?: unknown; expiresAt?: unknown; resendSeconds?: unknown; message?: unknown } | null
    if (typeof pending?.challengeId !== 'string' || !CHALLENGE_ID.test(pending.challengeId) || typeof pending.expiresAt !== 'string') throw new Error('Сервер вернул неожиданный ответ')
    const resendSeconds = typeof pending.resendSeconds === 'number' && Number.isFinite(pending.resendSeconds) ? Math.max(0, Math.min(3600, Math.round(pending.resendSeconds))) : 60
    const message = typeof pending.message === 'string' && pending.message.length <= 300 ? pending.message : 'Мы отправили код на e-mail. Введите его, чтобы завершить регистрацию.'
    return { pending: { challengeId: pending.challengeId, expiresAt: pending.expiresAt, resendSeconds, message } }
  }
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось зарегистрироваться: ${response.status}`)
  return adoptSessionAnswer(result)
}

/** The code from the registration e-mail (POST /v1/accounts/register/confirm): the account appears, signed in here. */
export async function accountRegisterConfirm(rawChallenge: unknown, rawCode: unknown): Promise<{ status: AccountStatus; referralApplied: boolean }> {
  const challengeId = typeof rawChallenge === 'string' ? rawChallenge : ''
  const code = typeof rawCode === 'string' ? rawCode.replace(/[\s-]/g, '') : ''
  if (!CHALLENGE_ID.test(challengeId)) throw new Error('Запросите код ещё раз')
  if (!/^\d{6}$/.test(code)) throw new Error('Код из письма — 6 цифр')
  const { response, result } = await sendAccountRequest('/v1/accounts/register/confirm', { challengeId, code })
  if (!response.ok) throw new Error((result as { error?: string } | null)?.error ?? `Не удалось подтвердить e-mail: ${response.status}`)
  return adoptSessionAnswer(result)
}

export async function accountLogout(): Promise<AccountStatus> {
  await loadSession()
  const token = sessionToken
  const server = account?.server
  await clearSession()
  // Signing out also forgets the server key pinned on first use (a rotated key is then accepted on the next sign-in).
  if (server) await forgetServerKey(server)
  if (token) await send('POST', '/v1/accounts/logout', { token, timeoutMs: 5000 }).catch(() => undefined)
  return accountStatus()
}
