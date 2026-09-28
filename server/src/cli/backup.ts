/**
 * Consistent online copy of the SQLite database (works while the API server is running).
 *   npm --prefix server run backup [-- <target file>]
 * Default target: data/backups/companion-<timestamp>.sqlite next to the database.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { resolveDbPath } from '../services/database.js'

const source = resolveDbPath()
if (!existsSync(source)) {
  console.error(`Database not found: ${source}`)
  process.exit(1)
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const target = resolve(process.argv[2] ?? join(dirname(source), 'backups', `companion-${stamp}.sqlite`))
if (existsSync(target)) {
  console.error(`Target already exists: ${target}`)
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
const db = new DatabaseSync(source, { readOnly: true })
try {
  db.prepare('VACUUM INTO ?').run(target)
  console.log(`Backup written: ${target}`)
} finally {
  db.close()
}
