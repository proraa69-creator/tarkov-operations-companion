/**
 * Operator CLI: grant streamer status and a referral code to an existing account.
 *   npm --prefix server run promote -- <email> <code>
 * Writes directly to the SQLite database (TARKOV_DB_PATH, default data/companion.sqlite relative to the
 * working directory, i.e. server/data/companion.sqlite when run through npm --prefix server).
 * There is intentionally no HTTP endpoint for this. The API server may keep running (WAL mode).
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { AccountError, AccountStore } from '../services/accountStore.js'
import { openDatabase, resolveDbPath } from '../services/database.js'

export function promoteStreamer(dbPath: string, email: string, code: string) {
  const db = openDatabase(dbPath)
  try {
    const store = new AccountStore({ db })
    return store.promoteToStreamer(email, code)
  } finally {
    db.close()
  }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const [email, code] = process.argv.slice(2)
  if (!email || !code) {
    console.error('Usage: npm --prefix server run promote -- <email> <code>')
    process.exit(2)
  }
  const dbPath = resolveDbPath()
  try {
    const applied = promoteStreamer(dbPath, email, code)
    console.log(`Streamer promoted: ${email.trim().toLowerCase()} -> referral code ${applied} (database: ${dbPath})`)
  } catch (error) {
    console.error(error instanceof AccountError || error instanceof Error ? error.message : 'Promotion failed')
    process.exit(1)
  }
}
