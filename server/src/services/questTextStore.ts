import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Quest texts corrected by the owner in the quest constructor (owner app → «Карты» → «Редактировать квесты» → the quest
 * sheet at the bottom; owner, 13.10.2026: «в нижнем окне квеста могу редактировать описание»). Shared by every player
 * and every game mode, like the corrected points (services/questPointStore.ts); the app lays them over the catalog
 * (src/data/questTextOverrides.ts). One text per quest field and language:
 *
 * - `description`: the quest's description (`target` '');
 * - `objective`: one objective's line (`target` = the tarkov.dev objective id);
 * - `stage-title` / `stage-description`: a story chapter stage (`target` = the stage index).
 *
 * `lang`: the interface language the owner edited in — a Russian correction never replaces the English text.
 */
export type QuestTextField = 'description' | 'objective' | 'stage-title' | 'stage-description'
export type QuestTextLang = 'ru' | 'en'

export interface QuestTextOverride {
  id: string
  questId: string
  field: QuestTextField
  target: string
  lang: QuestTextLang
  text: string
  updatedBy: string
  updatedAt: string
}

export type QuestTextInput = Pick<QuestTextOverride, 'questId' | 'field' | 'target' | 'lang' | 'text'>

/** Far more than all quest texts of all quests in both languages; protects the table from a runaway client. */
export const MAX_QUEST_TEXT_OVERRIDES = 8000
export const QUEST_TEXT_MAX_LENGTH = 2000

interface Row { id: string; quest_id: string; field: string; target: string; lang: string; text: string; updated_by: string; updated_at: string }

export class QuestTextStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS quest_text_overrides (
        id TEXT PRIMARY KEY,
        quest_id TEXT NOT NULL,
        field TEXT NOT NULL,
        target TEXT NOT NULL,
        lang TEXT NOT NULL,
        text TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS quest_text_overrides_key ON quest_text_overrides(quest_id, field, target, lang);`)
  }

  list(): QuestTextOverride[] {
    const rows = this.db.prepare('SELECT * FROM quest_text_overrides ORDER BY updated_at, id').all() as unknown as Row[]
    return rows.map(toOverride)
  }

  get(id: string): QuestTextOverride | undefined {
    const row = this.db.prepare('SELECT * FROM quest_text_overrides WHERE id = ?').get(id) as unknown as Row | undefined
    return row ? toOverride(row) : undefined
  }

  /** Saves the text of one field (replacing an earlier correction of it); `full` when the table is full. */
  save(input: QuestTextInput, actor: string): QuestTextOverride | 'full' {
    const existing = this.db.prepare('SELECT id FROM quest_text_overrides WHERE quest_id = ? AND field = ? AND target = ? AND lang = ?')
      .get(input.questId, input.field, input.target, input.lang) as { id: string } | undefined
    if (!existing) {
      const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM quest_text_overrides').get() as { n: number }).n)
      if (count >= MAX_QUEST_TEXT_OVERRIDES) return 'full'
    }
    const row: Row = {
      id: existing?.id ?? randomBytes(12).toString('hex'),
      quest_id: input.questId,
      field: input.field,
      target: input.target,
      lang: input.lang,
      text: input.text,
      updated_by: actor,
      updated_at: new Date(this.now()).toISOString(),
    }
    this.db.prepare(`INSERT INTO quest_text_overrides (id, quest_id, field, target, lang, text, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET text = excluded.text, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(row.id, row.quest_id, row.field, row.target, row.lang, row.text, row.updated_by, row.updated_at)
    return toOverride(row)
  }

  /** The removed correction («Вернуть исходный текст»), or undefined when there was none. */
  remove(id: string): QuestTextOverride | undefined {
    const found = this.get(id)
    if (!found) return undefined
    this.db.prepare('DELETE FROM quest_text_overrides WHERE id = ?').run(id)
    return found
  }
}

const FIELDS: readonly QuestTextField[] = ['description', 'objective', 'stage-title', 'stage-description']

function toOverride(row: Row): QuestTextOverride {
  return {
    id: row.id,
    questId: row.quest_id,
    field: (FIELDS as readonly string[]).includes(row.field) ? row.field as QuestTextField : 'description',
    target: row.target,
    lang: row.lang === 'en' ? 'en' : 'ru',
    text: row.text,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}
