import type { DatabaseSync } from 'node:sqlite'

/**
 * The owner's notice over every app (owner, 13.10.2026: «окно уведомления сверху, я буду писать в своей серверной версии
 * сообщение, а оно будет появлятся у всех моментально, пока я не отключу его. для уведомления что ведутся технические
 * работы»). One notice: its text, whether it is shown, who changed it and when.
 */
export const ANNOUNCEMENT_MAX_LENGTH = 500

export interface Announcement { text: string; active: boolean; updatedBy: string; updatedAt: string }

interface Row { text: string; active: number; updated_by: string; updated_at: string }

export class AnnouncementStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS announcement (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        text TEXT NOT NULL,
        active INTEGER NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);`)
  }

  current(): Announcement | null {
    const row = this.db.prepare('SELECT text, active, updated_by, updated_at FROM announcement WHERE id = 1').get() as unknown as Row | undefined
    return row ? { text: row.text, active: row.active === 1, updatedBy: row.updated_by, updatedAt: row.updated_at } : null
  }

  /** What every app gets: the text while it is shown, nothing else (no author). */
  publicView(): { text: string; updatedAt: string } | null {
    const current = this.current()
    return current?.active && current.text ? { text: current.text, updatedAt: current.updatedAt } : null
  }

  save(text: string, active: boolean, actor: string): Announcement {
    const updatedAt = new Date(this.now()).toISOString()
    this.db.prepare(`INSERT INTO announcement (id, text, active, updated_by, updated_at) VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET text = excluded.text, active = excluded.active, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(text, active ? 1 : 0, actor, updatedAt)
    return { text, active, updatedBy: actor, updatedAt }
  }
}
