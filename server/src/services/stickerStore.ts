/**
 * The owner's sticker packs (owner, 07.11.2026: «в админ приложении на телефоне сделай мне функцию добавлять стикеры… И
 * там я буду делать паки стикеров. Которые по нажатию кнопки добавить будут добавляться в приложение на ПК и телефон»):
 * made in the iPhone admin (src/admin/stickers/), read by every app's sticker picker (routes/stickers.ts).
 *
 * The tables are created with IF NOT EXISTS, nothing is ever dropped:
 *   sticker_packs  — a pack: a random 24-hex id, its name, `published` («Добавить»: the apps show it; «Убрать»: they do
 *                    not), its place among the packs (`sort`) and when it was made and last changed;
 *   sticker_images — a sticker: a random 24-hex id, its pack, its place in the pack, width × height, size and the PNG
 *                    itself (checked by its bytes, never by what the app declared: services/bugReportStore.ts sniffImage).
 * A pack's stickers go with it (a trigger). A sticker's id never shows another picture: its address can be kept for ever
 * (routes/stickers.ts). The packs are the owner's own work, not a conversation: they stay in the backups (unlike the chat,
 * services/serverBackups.ts).
 *
 * `version` of the published packs (catalog) is a hash of what the apps show: it moves with any change of a published
 * pack (its name, its stickers or their order, «Добавить» / «Убрать», the order of the packs), so an app keeps its copy
 * until it does.
 */
import type { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { transaction } from './database.js'
import { sniffImage } from './bugReportStore.js'
import { imageSize } from './imageSize.js'
import { cleanSupportText } from '../../../src/shared/supportChat.js'
import { OWNER_STICKER_ID, STICKER_LIMITS, STICKER_PACK_ID, type StickerCatalog, type StickerCatalogPack } from '../../../src/shared/supportStickers.js'

type Row = Record<string, unknown>

/** A sticker as the owner's admin reads it. */
export interface OwnerSticker { id: string; width: number; height: number; size: number }
/** A pack as the owner's admin reads it: every pack, published or not. */
export interface OwnerStickerPack { id: string; name: string; published: boolean; createdAt: string; updatedAt: string; stickers: OwnerSticker[] }

export const PACK_NAME_MESSAGE = `Название пака — от 1 до ${STICKER_LIMITS.name} символов`
export const PACK_NOT_FOUND = 'Пак не найден'
export const STICKER_NOT_FOUND = 'Стикер не найден'
export const STICKER_TYPE_MESSAGE = 'Стикер — только картинка PNG'
export const STICKER_TOO_BIG = `Стикер больше ${STICKER_LIMITS.bytes / 1024} КБ`
export const STICKER_TOO_LARGE = `Стикер больше ${STICKER_LIMITS.side}×${STICKER_LIMITS.side} точек`
export const STICKER_BROKEN = 'Повреждённый файл стикера'
export const TOO_MANY_PACKS = `Не больше ${STICKER_LIMITS.packs} паков`
export const TOO_MANY_STICKERS = `В паке не больше ${STICKER_LIMITS.perPack} стикеров`
export const ORDER_MISMATCH = 'Порядок не совпадает с тем, что есть на сервере'

export class StickerError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS sticker_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sticker_images (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    sort INTEGER NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    data BLOB NOT NULL,
    created_at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS sticker_images_pack ON sticker_images(pack_id, sort);
  CREATE TRIGGER IF NOT EXISTS sticker_packs_images AFTER DELETE ON sticker_packs
    BEGIN DELETE FROM sticker_images WHERE pack_id = OLD.id; END;
`

/** A pack's name as it is kept: one line, no control characters, spaces squeezed; throws 400 for an empty or long one. */
export function stickerPackName(raw: unknown) {
  const name = typeof raw === 'string' ? cleanSupportText(raw).replace(/\s+/g, ' ').trim() : ''
  if (!name || Array.from(name).length > STICKER_LIMITS.name) throw new StickerError(400, PACK_NAME_MESSAGE)
  return name
}

/**
 * Checks a sticker's picture: a whole PNG (by its first bytes and its last chunk) of at most STICKER_LIMITS.side on each
 * side and STICKER_LIMITS.bytes; returns its size in pixels. Throws 400 with the reason (Russian, for the admin's uiText).
 */
export function checkStickerPng(file: Buffer): { width: number; height: number } {
  if (!file.length) throw new StickerError(400, STICKER_BROKEN)
  if (file.length > STICKER_LIMITS.bytes) throw new StickerError(400, STICKER_TOO_BIG)
  if (sniffImage(file) !== 'image/png') throw new StickerError(400, STICKER_TYPE_MESSAGE)
  const size = imageSize(file, 'image/png')
  // The IEND chunk closes every whole PNG: a cut-off upload is refused rather than shown half.
  if (!size || file.length < 45 || file.toString('latin1', file.length - 8, file.length - 4) !== 'IEND') throw new StickerError(400, STICKER_BROKEN)
  if (size.width > STICKER_LIMITS.side || size.height > STICKER_LIMITS.side) throw new StickerError(400, STICKER_TOO_LARGE)
  return size
}

const iso = (value: unknown) => new Date(Number(value)).toISOString()
const newId = () => randomBytes(12).toString('hex')

export interface StickerStoreOptions {
  now?: () => number
}

export class StickerStore {
  private readonly db: DatabaseSync
  private readonly now: () => number

  constructor(db: DatabaseSync, options: StickerStoreOptions = {}) {
    this.db = db
    this.now = options.now ?? Date.now
    this.db.exec(SCHEMA)
  }

  /** Every pack in its order, with its stickers in theirs (the owner's admin). */
  packs(): OwnerStickerPack[] {
    const packs = this.db.prepare('SELECT * FROM sticker_packs ORDER BY sort, created_at').all() as Row[]
    const stickers = this.db.prepare('SELECT id, pack_id, width, height, size FROM sticker_images ORDER BY pack_id, sort, created_at').all() as Row[]
    const byPack = new Map<string, OwnerSticker[]>()
    for (const row of stickers) {
      const list = byPack.get(String(row.pack_id)) ?? []
      list.push({ id: String(row.id), width: Number(row.width), height: Number(row.height), size: Number(row.size) })
      byPack.set(String(row.pack_id), list)
    }
    return packs.map((row) => ({
      id: String(row.id), name: String(row.name), published: Number(row.published) === 1, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
      stickers: byPack.get(String(row.id)) ?? [],
    }))
  }

  /** The published packs as the apps show them, in order; a published pack without a sticker is left out. */
  catalog(): StickerCatalog {
    const all = this.packs().filter((pack) => pack.published && pack.stickers.length)
    const packs: StickerCatalogPack[] = all.map((pack) => ({ id: pack.id, name: pack.name, stickers: pack.stickers.map(({ id, width, height }) => ({ id, width, height })) }))
    const version = createHash('sha256').update(JSON.stringify(packs)).digest('hex').slice(0, 16)
    const updatedAt = all.length ? new Date(Math.max(...all.map((pack) => Date.parse(pack.updatedAt)))).toISOString() : null
    return { version, updatedAt, packs }
  }

  private pack(id: string): OwnerStickerPack {
    const pack = STICKER_PACK_ID.test(id) ? this.packs().find((entry) => entry.id === id) : undefined
    if (!pack) throw new StickerError(404, PACK_NOT_FOUND)
    return pack
  }

  private touch(id: string) {
    this.db.prepare('UPDATE sticker_packs SET updated_at = ? WHERE id = ?').run(this.now(), id)
  }

  /** A new pack, last of the packs and not published yet; 409 past STICKER_LIMITS.packs. */
  createPack(rawName: unknown): OwnerStickerPack {
    const name = stickerPackName(rawName)
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM sticker_packs').get() as Row
      if (Number(row.n) >= STICKER_LIMITS.packs) throw new StickerError(409, TOO_MANY_PACKS)
      const id = newId()
      const at = this.now()
      this.db.prepare('INSERT INTO sticker_packs (id, name, published, sort, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)').run(id, name, Number(row.last) + 1, at, at)
      return this.pack(id)
    })
  }

  /** Renames a pack and / or publishes it («Добавить», `published` true) or takes it back («Убрать»); 404 for no pack. */
  updatePack(id: string, change: { name?: unknown; published?: boolean }): OwnerStickerPack {
    const name = change.name === undefined ? undefined : stickerPackName(change.name)
    return transaction(this.db, () => {
      this.pack(id)
      if (name !== undefined) this.db.prepare('UPDATE sticker_packs SET name = ? WHERE id = ?').run(name, id)
      if (change.published !== undefined) this.db.prepare('UPDATE sticker_packs SET published = ? WHERE id = ?').run(change.published ? 1 : 0, id)
      this.touch(id)
      return this.pack(id)
    })
  }

  /** Deletes a pack with its stickers; their messages in the chats read as a sticker that is gone. False for no pack. */
  deletePack(id: string): boolean {
    if (!STICKER_PACK_ID.test(id)) return false
    return Number(this.db.prepare('DELETE FROM sticker_packs WHERE id = ?').run(id).changes) > 0
  }

  /** The packs in the order of `ids`, which must name every pack once (400 otherwise). */
  orderPacks(ids: unknown): void {
    transaction(this.db, () => {
      const known = (this.db.prepare('SELECT id FROM sticker_packs').all() as Row[]).map((row) => String(row.id))
      if (!samePermutation(ids, known)) throw new StickerError(400, ORDER_MISMATCH)
      const set = this.db.prepare('UPDATE sticker_packs SET sort = ? WHERE id = ?')
      ;(ids as string[]).forEach((id, index) => set.run(index, id))
      // The published order is what the apps show: their copy follows (the catalog's hash moves by itself).
      this.db.prepare('UPDATE sticker_packs SET updated_at = ?').run(this.now())
    })
  }

  /** Adds a sticker (a PNG, checkStickerPng) as the last of the pack; 404 for no pack, 409 past STICKER_LIMITS.perPack. */
  addSticker(packId: string, file: Buffer): OwnerSticker {
    const size = checkStickerPng(file)
    return transaction(this.db, () => {
      this.pack(packId)
      const row = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) AS last FROM sticker_images WHERE pack_id = ?').get(packId) as Row
      if (Number(row.n) >= STICKER_LIMITS.perPack) throw new StickerError(409, TOO_MANY_STICKERS)
      const id = newId()
      this.db.prepare('INSERT INTO sticker_images (id, pack_id, sort, size, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, packId, Number(row.last) + 1, file.length, size.width, size.height, file, this.now())
      this.touch(packId)
      return { id, ...size, size: file.length }
    })
  }

  /** Deletes a sticker; its messages in the chats read as a sticker that is gone. False for no sticker. */
  deleteSticker(id: string): boolean {
    if (!OWNER_STICKER_ID.test(id)) return false
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT pack_id FROM sticker_images WHERE id = ?').get(id) as Row | undefined
      if (!row) return false
      this.db.prepare('DELETE FROM sticker_images WHERE id = ?').run(id)
      this.touch(String(row.pack_id))
      return true
    })
  }

  /** The pack's stickers in the order of `ids`, which must name each of them once (400 otherwise; 404 for no pack). */
  orderStickers(packId: string, ids: unknown): OwnerStickerPack {
    return transaction(this.db, () => {
      const pack = this.pack(packId)
      if (!samePermutation(ids, pack.stickers.map((sticker) => sticker.id))) throw new StickerError(400, ORDER_MISMATCH)
      const set = this.db.prepare('UPDATE sticker_images SET sort = ? WHERE id = ?')
      ;(ids as string[]).forEach((id, index) => set.run(index, id))
      this.touch(packId)
      return this.pack(packId)
    })
  }

  /** A sticker's PNG, published or not (its random id is its key); undefined for none. */
  image(id: string): Buffer | undefined {
    if (!OWNER_STICKER_ID.test(id)) return undefined
    const row = this.db.prepare('SELECT data FROM sticker_images WHERE id = ?').get(id) as Row | undefined
    return row ? Buffer.from(row.data as Uint8Array) : undefined
  }

  /**
   * The stickers of `ids` that still exist, with their pack's name and whether it is published (the support chat: a
   * message may carry only a published one; what a message reads when its sticker is gone). One query for all of them.
   */
  describe(ids: Iterable<string>): Map<string, { pack: string; published: boolean }> {
    const wanted = [...new Set([...ids].filter((id) => OWNER_STICKER_ID.test(id)))]
    const found = new Map<string, { pack: string; published: boolean }>()
    for (let start = 0; start < wanted.length; start += 500) {
      const part = wanted.slice(start, start + 500)
      const rows = this.db.prepare(`SELECT s.id, p.name, p.published FROM sticker_images s JOIN sticker_packs p ON p.id = s.pack_id WHERE s.id IN (${part.map(() => '?').join(',')})`).all(...part) as Row[]
      for (const row of rows) found.set(String(row.id), { pack: String(row.name), published: Number(row.published) === 1 })
    }
    return found
  }
}

/** `ids` names each of `known` exactly once. */
function samePermutation(ids: unknown, known: string[]) {
  if (!Array.isArray(ids) || ids.length !== known.length || !ids.every((id) => typeof id === 'string')) return false
  const set = new Set(ids as string[])
  return set.size === known.length && known.every((id) => set.has(id))
}
