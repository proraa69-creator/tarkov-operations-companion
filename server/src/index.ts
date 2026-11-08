import { createApi } from './app.js'
import { ProgressStore } from './services/progressStore.js'
import { AccountStore } from './services/accountStore.js'
import { SqliteGoonStore } from './services/goonStore.js'
import { UserDataStore } from './services/userDataStore.js'
import { openDatabase, resolveDbPath } from './services/database.js'
import { PaymentStore, paymentConfigFromEnv } from './services/paymentStore.js'
import { PayoutStore } from './services/payoutStore.js'
import { InviteProgram } from './services/invites.js'
import { PhoneAuthService } from './services/phoneAuth.js'
import { createSmsSender, smsConfigFromEnv, smsLimitsFromEnv } from './services/sms/index.js'
import { EmailAuthService } from './services/emailAuth.js'
import { createEmailSender, emailConfigFromEnv, emailLimitsFromEnv } from './services/email/index.js'
import { bugReportEmailFromEnv } from './services/bugReportMail.js'
import { dirname, join } from 'node:path'
import { mkdirSync, rmSync } from 'node:fs'
import { MobileDownloads } from './services/mobileDownloads.js'
import { iphoneStoreReader } from './services/iphoneStore.js'
import { appleIapConfigFromEnv, createAppleVerifier, ensureAppleRootCertificate, lazyAppleVerifier } from './services/appleSubscriptions.js'
import { MapMirror } from './services/mapMirror.js'
import { MirrorStorage } from './services/mirrorStorage.js'
import { LegacyGraphqlBuilder } from './services/legacyGraphqlBuilder.js'
import { PriceHistoryMirror } from './services/priceHistoryMirror.js'
import { TarkovDataMirror, type MirrorMode } from './services/tarkovDataMirror.js'
import { PriceMirror } from './services/priceMirror.js'
import { overlayKeyFrom, PriceOverlay } from './services/priceOverlay.js'
import { TradingStats } from './services/tradingStats.js'
import { DataGateway } from './services/dataGateway.js'
import { EntitlementService } from './services/entitlement.js'
import { installProcessGuards } from './services/serverHealth.js'
import { configureCatalogMirror, configureEventQuests, configureGuideImages, configureQuestBase } from './services/catalogService.js'
import { EventQuestStore } from './services/eventQuestStore.js'
import { GuideImageMirror } from './services/guideImages.js'
import { questBasePeriodMs } from './services/questBase.js'
import { BezebeeCredentialStore } from './services/bezebeeWebhook.js'
import type { RaidMode } from '../../src/domain/types'
import { OnlineStatsStore, ONLINE_SAMPLE_MS } from './services/onlineStatsStore.js'
import { fetchLiveVersion, startReleaseReports, type ReleaseReportsWiring } from './services/releaseReports.js'
import UPDATE_HISTORY from '../../src/data/updateHistory.json'

// Unhandled exceptions / rejections: logged with the stack to api.log and counted for the watchdog (docs/server-guard.md).
installProcessGuards()

// One SQLite file holds everything: accounts, sessions, referral stats, goon sightings, quest events, user data.
const dbPath = resolveDbPath()
const db = openDatabase(dbPath)
const store = new ProgressStore(db)
// The streamer programme is paused (owner, 09.10.2026): a streamer's code gives no free days. The free days count from
// the first raid (owner, 08.11.2026: «все последующие, кто будут регистрироваться, у них должна быть такая же система»).
const accounts = new AccountStore({ db, streamerTrial: false, trialFromFirstRaid: true })
const payments = new PaymentStore(db, paymentConfigFromEnv())
accounts.attachSubscriptions(payments)
// Server-owned online history: one sample a minute, whether or not an admin panel is open.
const onlineStats = new OnlineStatsStore(db)
const sampleOnline = () => { try { onlineStats.sample() } catch (error) { console.error('Online statistics failed', error instanceof Error ? error.message : 'unknown error') } }
sampleOnline()
const onlineTimer = setInterval(sampleOnline, ONLINE_SAMPLE_MS)
onlineTimer.unref()
const payouts = new PayoutStore(db, payments)
// «Пригласи друга»: every hour, grant the rewards whose 14-day check is over (services/invites.ts).
const invites = new InviteProgram(accounts, payments)
const releaseInvites = () => { try { invites.release() } catch (error) { console.error('Invite rewards failed', error instanceof Error ? error.message : 'unknown error') } }
releaseInvites()
setInterval(releaseInvites, 60 * 60 * 1000).unref()
// «Удалить аккаунт»: every hour, delete the accounts whose 10 days after the request are over (AccountStore.runDueDeletions).
const runDeletions = () => { try { accounts.runDueDeletions() } catch (error) { console.error('Scheduled account deletion failed', error instanceof Error ? error.message : 'unknown error') } }
runDeletions()
setInterval(runDeletions, 60 * 60 * 1000).unref()
// Streamer auto-payouts: every hour, request the balance of each streamer whose N-day cycle is over.
const runAutoPayouts = () => { try { payouts.runAuto((id) => accounts.streamerCode(id)) } catch (error) { console.error('Auto-payout failed', error) } }
runAutoPayouts()
setInterval(runAutoPayouts, 60 * 60 * 1000).unref()
// ЮKassa autopayments: every hour, charge the saved method of subscriptions whose paid period ends within a day
// (only with the payer's autopayment consent and while the owner keeps autopayments on; see PaymentStore.runRecurring).
const runRecurring = () => { payments.runRecurring().catch((error: unknown) => console.error('Autopayment run failed', error instanceof Error ? error.message : 'unknown error')) }
runRecurring()
setInterval(runRecurring, 60 * 60 * 1000).unref()
// Boosty is gone (owner, 03.11.2026: «все что связано с бусти удаляй, с ними мы больше не работаем»): the Boosty sessions
// an older server kept next to the database go too (its tables: PaymentStore, removeBoosty).
if (dbPath !== ':memory:') for (const name of ['boosty-tokens.json', 'boosty-credentials.json']) rmSync(join(dirname(dbPath), name), { force: true })
// SMS one-time codes (phone binding, sign-in and password reset by phone): only with a provider set in the owner's app.
const smsConfig = smsConfigFromEnv()
const phones = new PhoneAuthService(accounts, { sender: smsConfig ? createSmsSender(smsConfig) : undefined, limits: smsLimitsFromEnv() })
// E-mail one-time codes (registration confirmation, sign-in and reset by e-mail): only with a provider set in the owner's app.
const emailConfig = emailConfigFromEnv()
const emailSender = emailConfig ? createEmailSender(emailConfig) : undefined
const emails = new EmailAuthService(accounts, { sender: emailSender, limits: emailLimitsFromEnv() })
// «Сообщить об ошибке»: every report as a PDF to the owner's mailbox (TARKOV_BUG_REPORT_EMAIL, default raidosapp@gmail.com).
const bugReportMail = { sender: emailSender, to: bugReportEmailFromEnv() }
// Signed entitlements: the private key comes from TARKOV_ENTITLEMENT_PRIVATE_KEY (the owner's app keeps it encrypted) or
// lives next to the database (entitlement-ed25519.pem, created on the first start). Never in the repository.
const entitlements = new EntitlementService(accounts, { keyDir: dbPath === ':memory:' ? undefined : dirname(dbPath) })
// «Карты у нас на сервере» (owner, 10.10.2026): tarkov.dev's tiles and schemes next to the database, mirrored in the
// background and served at /v1/map-tiles. Off in the owner's desktop app (RAIDOS_MAP_MIRROR=0, electron/localServer.ts).
const mirrorEnabled = dbPath !== ':memory:' && process.env.RAIDOS_DATA_MIRROR !== '0'
const mirrorRoot = process.env.RAIDOS_MIRROR_DIR || process.env.RAIDOS_MAP_MIRROR_DIR || join(dirname(dbPath), 'map-mirror')
const mirrorStorage = mirrorEnabled ? new MirrorStorage({ root: mirrorRoot, requireMount: process.env.RAIDOS_MIRROR_REQUIRE_MOUNT === '1' }) : undefined
if (mirrorStorage) configureCatalogMirror(mirrorStorage)
const itemImageDir = mirrorEnabled ? join(mirrorRoot, 'images', 'items') : undefined
if (itemImageDir) {
  process.env.RAIDOS_ITEM_IMAGE_DIR ||= itemImageDir
  process.env.RAIDOS_ITEM_IMAGE_URL ||= `${(process.env.TARKOV_PUBLIC_URL || 'https://raidos.app').replace(/\/$/, '')}/v1/item-images`
}
// «Оружейник»: tarkov.help's finished-build screenshots kept next to the item images and served at /v1/guide-images.
const guideImages = mirrorEnabled ? new GuideImageMirror({
  directory: join(mirrorRoot, 'images', 'guides'),
  publicBase: `${(process.env.TARKOV_PUBLIC_URL || 'https://raidos.app').replace(/\/$/, '')}/v1/guide-images`,
  log: (message) => console.log(message),
}) : undefined
configureGuideImages(guideImages)
// «Фото мест»: every quest photo of the lists kept on our server ahead of the players (GuideImageMirror.storeListed) — a
// minute after the start, then every 6 hours for one that failed; a line when something was downloaded or failed.
if (guideImages) {
  let first = true
  const storeGuidePhotos = () => guideImages.storeListed().then((result) => {
    if (first || result.downloaded || result.failed) console.log(`Quest photos on the server: ${result.listed} listed, ${result.stored} stored before, ${result.downloaded} downloaded, ${result.failed} failed`)
    first = false
  }, (error: unknown) => console.error('Quest photos failed', error instanceof Error ? error.message : 'unknown error'))
  setTimeout(() => void storeGuidePhotos(), 60_000).unref()
  setInterval(() => void storeGuidePhotos(), 6 * 60 * 60 * 1000).unref()
}
// «Одна общая база квестов» (owner, 14.10.2026): every mode's catalog in Russian and English, built every
// RAIDOS_QUEST_BASE_MINUTES (30) and after each new tarkov.dev download, kept next to the database and read back at once
// after a restart (services/questBase.ts). The players' apps get it from there; nothing is built per request.
const questBase = configureQuestBase({
  dir: dbPath === ':memory:' ? undefined : join(dirname(dbPath), 'quest-base'),
  periodMs: questBasePeriodMs(process.env.RAIDOS_QUEST_BASE_MINUTES),
  app: { version: process.env.TARKOV_APP_VERSION, build: Number(process.env.TARKOV_APP_BUILD) || undefined, commit: process.env.TARKOV_APP_COMMIT },
  log: (message) => console.log(message),
})
// «Ивент-квесты» (routes/eventQuests.ts): every build adds them; a saved change asks for a new build.
const eventQuests = new EventQuestStore(db)
configureEventQuests(() => eventQuests.list())
const QUEST_BASE_MODE: Record<MirrorMode, RaidMode> = { regular: 'pvp', pve: 'pve', 'pvp-season': 'seasonal' }
const dataMirror = mirrorStorage ? new TarkovDataMirror({
  storage: mirrorStorage,
  log: (message) => console.log(message),
  onPublished: (modes) => questBase.mirrorUpdated(modes.map((mode) => QUEST_BASE_MODE[mode])),
}) : undefined
const priceMirror = mirrorStorage ? new PriceMirror({ storage: mirrorStorage, log: (message) => console.log(message), overlay: new PriceOverlay({ readKey: overlayKeyFrom(), log: (message) => console.log(message) }) }) : undefined
const mapMirror = mirrorEnabled && process.env.RAIDOS_MAP_MIRROR !== '0'
  // Keep the existing layout: maps.json at the mirror root, tiles below root/maps/*.
  ? new MapMirror({ dir: mirrorRoot, storage: mirrorStorage, log: (message) => console.log(message) })
  : undefined
mapMirror?.start()
void questBase.start()
dataMirror?.start()
priceMirror?.start()
const priceHistory = mirrorStorage ? new PriceHistoryMirror({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
priceHistory?.start()
// «Торговля»: a slow pass a few times a day; RAIDOS_TRADING_STATS=0 turns it off, the app then says the statistics are not ready.
const tradingStats = mirrorStorage && process.env.RAIDOS_TRADING_STATS !== '0' ? new TradingStats({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
tradingStats?.start()
const data = new DataGateway({ mirror: mirrorStorage, strict: process.env.RAIDOS_DATA_STRICT === '1', priceHistory })
const legacyGraphql = mirrorStorage ? new LegacyGraphqlBuilder({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
legacyGraphql?.start()
// Photos of the quest constructor's points (owner app): files next to the database, never in the repository.
const questPointPhotoDir = dbPath === ':memory:' ? undefined : join(dirname(dbPath), 'quest-point-photos')
// The phone apps from GitHub releases, served from the site (services/mobileDownloads.ts); RAIDOS_MOBILE_DOWNLOADS=0 turns it off.
const mobileDownloads = dbPath === ':memory:' || process.env.RAIDOS_MOBILE_DOWNLOADS === '0' ? undefined : new MobileDownloads({ dir: join(dirname(dbPath), 'mobile-downloads'), log: (message) => console.log(message) })
if (mobileDownloads) {
  mkdirSync(join(dirname(dbPath), 'mobile-downloads'), { recursive: true })
  void mobileDownloads.refresh(true)
  setInterval(() => void mobileDownloads.refresh(true), 30 * 60 * 1000).unref()
}
// BZB (Bezebee) payment notifications: the API token and the webhook signing secret the owner pastes in the panel
// (bezebee-credentials.json, mode 600) or BEZEBEE_API_TOKEN / BEZEBEE_WEBHOOK_SECRET (services/bezebeeWebhook.ts).
const bezebeeCredentials = new BezebeeCredentialStore(dbPath === ':memory:' ? undefined : join(dirname(dbPath), 'bezebee-credentials.json'), { apiToken: process.env.BEZEBEE_API_TOKEN?.trim() || undefined, webhookSecret: process.env.BEZEBEE_WEBHOOK_SECRET?.trim() || undefined })
const bezebeeUsdRub = Number(process.env.BEZEBEE_USD_RUB) > 0 ? Number(process.env.BEZEBEE_USD_RUB) : undefined
// A report the owner took closes by itself once the release that lists it is live (services/releaseReports.ts). Not on the
// owner's own PC: its database is not the players' one.
const releaseReports = dbPath === ':memory:' || process.env.TARKOV_APP_EDITION === 'owner' ? undefined : (wiring: ReleaseReportsWiring) => {
  startReleaseReports({ ...wiring, history: UPDATE_HISTORY, liveVersion: () => fetchLiveVersion(process.env.TARKOV_PUBLIC_URL || 'https://raidos.app'), log: (line) => console.log(line) })
}
// The App Store switch for the iPhone app's «Обновить» (services/iphoneStore.ts): a JSON file beside the database.
// The iPhone app's subscription through Apple (services/appleSubscriptions.ts): APPLE_IAP=1 and the products; Apple's root
// certificate from APPLE_ROOT_CA_DIR, else fetched once from apple.com into the data folder at the first check.
const appleConfig = appleIapConfigFromEnv()
const appleRootDir = process.env.APPLE_ROOT_CA_DIR?.trim() || (dbPath === ':memory:' ? undefined : join(dirname(dbPath), 'apple-root-ca'))
const appleIap = appleConfig && appleRootDir
  ? { config: appleConfig, verifier: lazyAppleVerifier(async () => createAppleVerifier(appleConfig, await ensureAppleRootCertificate(appleRootDir))) }
  : undefined
if (appleIap) console.log(`Apple In-App Purchase: on (${appleConfig!.products.length} products${appleConfig!.appAppleId ? '' : ', Sandbox only: APPLE_APP_ID is not set'})`)
const iphoneStore = dbPath === ':memory:' ? undefined : iphoneStoreReader(process.env.RAIDOS_IPHONE_STORE_FILE ?? join(dirname(dbPath), 'iphone-store.json'))
const app = createApi(store, process.env.TARKOV_API_TOKEN, accounts, { iphoneStore, ...(appleIap ? { appleIap } : {}), iosPcAppLink: process.env.APPLE_PC_APP_LINK !== '0', promoChecks: true, releaseReports, questPointPhotoDir, goons: new SqliteGoonStore(db), userData: new UserDataStore(db), payments, payouts, invites, bezebeeCredentials, ...(bezebeeUsdRub ? { bezebeeUsdRub } : {}), bezebeeMailEveryMs: 60_000, phones, emails, entitlements, mapMirror, mirrorStorage, dataMirror, priceMirror, legacyGraphql, priceHistory, tradingStats, itemImageDir, guideImages, mobileDownloads, data, bugReportMail, questBase, eventQuests, eventQuestsChanged: () => questBase.contentChanged() })
const host = process.env.HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && !process.env.TARKOV_API_TOKEN) throw new Error('TARKOV_API_TOKEN required for a network listener')
const port = Number(process.env.PORT ?? 8787)
const listener = app.listen(port, host, () => console.log(`Raid OS API ready on http://${host}:${port} (database: ${dbPath}; payments ${payments.enabled ? 'on' : 'off'}${payments.config?.autopay ? ', autopay on' : ''}; SMS ${smsConfig ? smsConfig.provider : 'off'}; e-mail ${emailConfig ? emailConfig.provider : 'off'})`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  clearInterval(onlineTimer)
  mapMirror?.stop(); dataMirror?.stop(); priceMirror?.stop(); legacyGraphql?.stop(); priceHistory?.stop(); tradingStats?.stop(); questBase.stop()
  listener.close(() => { db.close(); process.exit(0) })
})
