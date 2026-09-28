import { createApi } from './app.js'
import { ProgressStore } from './services/progressStore.js'
import { AccountStore } from './services/accountStore.js'
import { SqliteGoonStore } from './services/goonStore.js'
import { UserDataStore } from './services/userDataStore.js'
import { openDatabase, resolveDbPath } from './services/database.js'

// One SQLite file holds everything: accounts, sessions, referral stats, goon sightings, quest events, user data.
const dbPath = resolveDbPath()
const db = openDatabase(dbPath)
const store = new ProgressStore(db)
const accounts = new AccountStore({ db })
const app = createApi(store, process.env.TARKOV_API_TOKEN, accounts, { goons: new SqliteGoonStore(db), userData: new UserDataStore(db) })
const host = process.env.HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && !process.env.TARKOV_API_TOKEN) throw new Error('TARKOV_API_TOKEN required for a network listener')
const port = Number(process.env.PORT ?? 8787)
const listener = app.listen(port, host, () => console.log(`Tarkov Operations API ready on http://${host}:${port} (database: ${dbPath})`))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => listener.close(() => { db.close(); process.exit(0) }))
