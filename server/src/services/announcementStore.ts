import type { DatabaseSync } from 'node:sqlite'
import { splitBilingualNotice, type NoticeLanguage } from './announcementLanguage.js'

/**
 * The owner's notice over every app (owner, 13.10.2026: «окно уведомления сверху, я буду писать в своей серверной версии
 * сообщение, а оно будет появлятся у всех моментально, пока я не отключу его. для уведомления что ведутся технические
 * работы»). One notice: its text, whether it is shown, who changed it and when. Since 14.10.2026 also its English for
 * foreign players (services/announcementLanguage.ts): the automatic translation or the owner's own.
 */
export const ANNOUNCEMENT_MAX_LENGTH = 500

/** Where the English came from: MyMemory's translation, or the owner's own words. */
export type EnglishSource = 'auto' | 'manual'

export interface Announcement {
  /** The owner's Russian: the CIS and unknown countries read it. */
  text: string
  /** What every other country reads; null: none (the translation failed), they read `text`. */
  textEn: string | null
  textEnSource: EnglishSource | null
  active: boolean
  updatedBy: string
  updatedAt: string
}

/** What every app gets; `lang`: the language of `text`. */
export interface PublicAnnouncement { text: string; lang: NoticeLanguage; updatedAt: string }

/** One past banner, newest first (owner, 16.10.2026: «должна так же сохранятся история банеров»). */
export interface AnnouncementHistoryEntry { id: number; text: string; textEn: string | null; active: boolean; updatedBy: string; updatedAt: string }

interface Row { text: string; text_en: string | null; text_en_source: string | null; active: number; updated_by: string; updated_at: string }

export class AnnouncementStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS announcement (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        text TEXT NOT NULL,
        active INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
    // Older databases: the English came later (14.10.2026); NULL for the notice already there.
    const columns = db.prepare('PRAGMA table_info(announcement)').all() as Array<{ name: string }>
    if (!columns.some((column) => column.name === 'text_en')) db.exec('ALTER TABLE announcement ADD COLUMN text_en TEXT')
    if (!columns.some((column) => column.name === 'text_en_source')) db.exec('ALTER TABLE announcement ADD COLUMN text_en_source TEXT')
    // Every save of a banner is kept so the owner can see the past banners (16.10.2026).
    db.exec(`CREATE TABLE IF NOT EXISTS announcement_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        text_en TEXT,
        active INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  /**
   * The notice as the owner edits it. One saved before the English came with its Russian and English paragraphs in one
   * text (13.10.2026) is read as both: the Russian paragraphs, and the English ones as the owner's own English.
   */
  current(): Announcement | null {
    const row = this.db.prepare('SELECT text, text_en, text_en_source, active, updated_by, updated_at FROM announcement WHERE id = 1').get() as unknown as Row | undefined
    if (!row) return null
    const split = row.text_en ? undefined : splitBilingualNotice(row.text)
    return {
      text: split?.ru ?? row.text,
      textEn: row.text_en || split?.en || null,
      textEnSource: row.text_en ? (row.text_en_source === 'manual' ? 'manual' : 'auto') : split ? 'manual' : null,
      active: row.active === 1,
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
    }
  }

  /** What every app gets: the text in the reader's language while it is shown, nothing else (no author). Russian while there is no English. */
  publicView(language: NoticeLanguage = 'ru'): PublicAnnouncement | null {
    const current = this.current()
    if (!current?.active || !current.text) return null
    return language === 'en' && current.textEn ? { text: current.textEn, lang: 'en', updatedAt: current.updatedAt } : { text: current.text, lang: 'ru', updatedAt: current.updatedAt }
  }

  /** `english`: the English to keep with it, or null for none. Returns the notice as `current()` reads it back. */
  save(text: string, active: boolean, actor: string, english: { text: string; source: EnglishSource } | null = null): Announcement {
    const updatedAt = new Date(this.now()).toISOString()
    this.db.prepare(`INSERT INTO announcement (id, text, text_en, text_en_source, active, updated_by, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = excluded.text, text_en = excluded.text_en, text_en_source = excluded.text_en_source, active = excluded.active,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(text, english?.text || null, english?.text ? english.source : null, active ? 1 : 0, actor, updatedAt)
    return this.current()!
  }

  /** Keep a shown banner in the history (owner, 16.10.2026); the caller records only a new or changed one, not a re-save. */
  addHistory(text: string, textEn: string | null, actor: string) {
    this.db.prepare('INSERT INTO announcement_history (text, text_en, active, updated_by, updated_at) VALUES (?, ?, 1, ?, ?)').run(text, textEn || null, actor, new Date(this.now()).toISOString())
  }

  /** The past banners, newest first (owner, 16.10.2026). */
  history(limit = 50): AnnouncementHistoryEntry[] {
    const rows = this.db.prepare('SELECT id, text, text_en, active, updated_by, updated_at FROM announcement_history ORDER BY id DESC LIMIT ?').all(limit) as unknown as Array<{ id: number; text: string; text_en: string | null; active: number; updated_by: string; updated_at: string }>
    return rows.map((row) => ({ id: Number(row.id), text: String(row.text), textEn: row.text_en == null ? null : String(row.text_en), active: row.active === 1, updatedBy: String(row.updated_by), updatedAt: String(row.updated_at) }))
  }
}
