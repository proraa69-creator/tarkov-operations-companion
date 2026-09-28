import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Default SQLite file, relative to the working directory of the server process. */
export const DEFAULT_DB_PATH = 'data/companion.sqlite'

export function resolveDbPath(path = process.env.TARKOV_DB_PATH ?? DEFAULT_DB_PATH) {
  return path === ':memory:' ? path : resolve(path)
}

/**
 * Opens the single SQLite database shared by every store (accounts, sessions, referral stats, goon sightings,
 * quest events and per-user data). WAL keeps readers and the single writer from blocking each other.
 */
export function openDatabase(path = resolveDbPath()): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
  return db
}

/** Runs `work` inside one transaction. node:sqlite is synchronous, so nothing else can interleave. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
