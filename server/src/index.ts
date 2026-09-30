import { createApi } from './app.js'
import { ProgressStore } from './services/progressStore.js'
import { AccountStore } from './services/accountStore.js'
import { SqliteGoonStore } from './services/goonStore.js'
import { UserDataStore } from './services/userDataStore.js'
import { openDatabase, resolveDbPath } from './services/database.js'
import { PaymentStore, paymentConfigFromEnv } from './services/paymentStore.js'
import { PayoutStore } from './services/payoutStore.js'
import { LavaClient, lavaConfigFromEnv } from './services/lavaTop.js'

// One SQLite file holds everything: accounts, sessions, referral stats, goon sightings, quest events, user data.
const dbPath = resolveDbPath()
const db = openDatabase(dbPath)
const store = new ProgressStore(db)
const accounts = new AccountStore({ db })
const lavaConfig = lavaConfigFromEnv()
const payments = new PaymentStore(db, paymentConfigFromEnv(), lavaConfig ? { lava: new LavaClient(lavaConfig) } : {})
accounts.attachSubscriptions(payments)
const payouts = new PayoutStore(db, payments)
// Streamer auto-payouts: every hour, request the balance of each streamer whose N-day cycle is over.
const runAutoPayouts = () => { try { payouts.runAuto((id) => accounts.streamerCode(id)) } catch (error) { console.error('Auto-payout failed', error) } }
runAutoPayouts()
setInterval(runAutoPayouts, 60 * 60 * 1000).unref()
// ЮKassa autopayments: every hour, charge the saved method of subscriptions whose paid period ends within a day
// (only with the payer's autopayment consent and while the owner keeps autopayments on; see PaymentStore.runRecurring).
const runRecurring = () => { payments.runRecurring().catch((error: unknown) => console.error('Autopayment run failed', error instanceof Error ? error.message : 'unknown error')) }
runRecurring()
setInterval(runRecurring, 60 * 60 * 1000).unref()
const app = createApi(store, process.env.TARKOV_API_TOKEN, accounts, { goons: new SqliteGoonStore(db), userData: new UserDataStore(db), payments, payouts })
const host = process.env.HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && !process.env.TARKOV_API_TOKEN) throw new Error('TARKOV_API_TOKEN required for a network listener')
const port = Number(process.env.PORT ?? 8787)
const listener = app.listen(port, host, () => console.log(`Tarkov Operator API ready on http://${host}:${port} (database: ${dbPath}; payments ${payments.enabled ? 'on' : 'off'}${payments.lava ? ', Lava.top on' : ''}${payments.config?.autopay ? ', autopay on' : ''})`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => listener.close(() => { db.close(); process.exit(0) }))
