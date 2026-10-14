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
import { MapMirror } from './services/mapMirror.js'
import { MirrorStorage } from './services/mirrorStorage.js'
import { LegacyGraphqlBuilder } from './services/legacyGraphqlBuilder.js'
import { PriceHistoryMirror } from './services/priceHistoryMirror.js'
import { TarkovDataMirror } from './services/tarkovDataMirror.js'
import { PriceMirror } from './services/priceMirror.js'
import { DataGateway } from './services/dataGateway.js'
import { EntitlementService } from './services/entitlement.js'
import { installProcessGuards } from './services/serverHealth.js'
import { configureCatalogMirror, configureGuideImages, configureQuestBase } from './services/catalogService.js'
import { GuideImageMirror } from './services/guideImages.js'
import { questBasePeriodMs } from './services/questBase.js'

// Unhandled exceptions / rejections: logged with the stack to api.log and counted for the watchdog (docs/server-guard.md).
installProcessGuards()

// One SQLite file holds everything: accounts, sessions, referral stats, goon sightings, quest events, user data.
const dbPath = resolveDbPath()
const db = openDatabase(dbPath)
const store = new ProgressStore(db)
// The streamer programme is paused (owner, 09.10.2026): a streamer's code gives no free days.
const accounts = new AccountStore({ db, streamerTrial: false })
const payments = new PaymentStore(db, paymentConfigFromEnv())
accounts.attachSubscriptions(payments)
const payouts = new PayoutStore(db, payments)
// «Пригласи друга»: every hour, grant the rewards whose 14-day check is over (services/invites.ts).
const invites = new InviteProgram(accounts, payments)
const releaseInvites = () => { try { invites.release() } catch (error) { console.error('Invite rewards failed', error instanceof Error ? error.message : 'unknown error') } }
releaseInvites()
setInterval(releaseInvites, 60 * 60 * 1000).unref()
// Streamer auto-payouts: every hour, request the balance of each streamer whose N-day cycle is over.
const runAutoPayouts = () => { try { payouts.runAuto((id) => accounts.streamerCode(id)) } catch (error) { console.error('Auto-payout failed', error) } }
runAutoPayouts()
setInterval(runAutoPayouts, 60 * 60 * 1000).unref()
// ЮKassa autopayments: every hour, charge the saved method of subscriptions whose paid period ends within a day
// (only with the payer's autopayment consent and while the owner keeps autopayments on; see PaymentStore.runRecurring).
const runRecurring = () => { payments.runRecurring().catch((error: unknown) => console.error('Autopayment run failed', error instanceof Error ? error.message : 'unknown error')) }
runRecurring()
setInterval(runRecurring, 60 * 60 * 1000).unref()
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
// «Одна общая база квестов» (owner, 14.10.2026): every mode's catalog in Russian and English, built every
// RAIDOS_QUEST_BASE_MINUTES (30), kept next to the database and read back at once after a restart
// (services/questBase.ts). The players' apps get it from there; nothing is built per request.
const questBase = configureQuestBase({
  dir: dbPath === ':memory:' ? undefined : join(dirname(dbPath), 'quest-base'),
  periodMs: questBasePeriodMs(process.env.RAIDOS_QUEST_BASE_MINUTES),
  app: { version: process.env.TARKOV_APP_VERSION, build: Number(process.env.TARKOV_APP_BUILD) || undefined, commit: process.env.TARKOV_APP_COMMIT },
  log: (message) => console.log(message),
})
const dataMirror = mirrorStorage ? new TarkovDataMirror({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
const priceMirror = mirrorStorage ? new PriceMirror({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
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
const data = new DataGateway({ mirror: mirrorStorage, strict: process.env.RAIDOS_DATA_STRICT === '1', priceHistory })
const legacyGraphql = mirrorStorage ? new LegacyGraphqlBuilder({ storage: mirrorStorage, log: (message) => console.log(message) }) : undefined
legacyGraphql?.start()
const app = createApi(store, process.env.TARKOV_API_TOKEN, accounts, { goons: new SqliteGoonStore(db), userData: new UserDataStore(db), payments, payouts, invites, phones, emails, entitlements, mapMirror, mirrorStorage, dataMirror, priceMirror, legacyGraphql, priceHistory, itemImageDir, guideImages, data, bugReportMail })
const host = process.env.HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && !process.env.TARKOV_API_TOKEN) throw new Error('TARKOV_API_TOKEN required for a network listener')
const port = Number(process.env.PORT ?? 8787)
const listener = app.listen(port, host, () => console.log(`Raid OS API ready on http://${host}:${port} (database: ${dbPath}; payments ${payments.enabled ? 'on' : 'off'}${payments.config?.autopay ? ', autopay on' : ''}; SMS ${smsConfig ? smsConfig.provider : 'off'}; e-mail ${emailConfig ? emailConfig.provider : 'off'})`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  mapMirror?.stop(); dataMirror?.stop(); priceMirror?.stop(); legacyGraphql?.stop(); priceHistory?.stop(); questBase.stop()
  listener.close(() => { db.close(); process.exit(0) })
})
