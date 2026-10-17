import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { sniffImage, type ImageMime } from './bugReportStore.js'
import { imageSize } from './imageSize.js'
import { QUEST_POINT_PHOTO_ID, QUEST_POINT_PHOTO_LIMITS } from '../../../src/shared/questPointConstructor.js'

/**
 * Photos of quest constructor points (owner, 16.10.2026: «возможность добавить … фотографию для понимания где искать»):
 * the owner's screenshots of where to look, uploaded from the owner app (routes/questPoints.ts) and shown to every
 * signed-in player on the point.
 *
 * The files live on disk under the server's data directory (`<data>/quest-point-photos/<id>.<png|jpg|webp>`, never in the
 * repository); a small table keeps what each one is:
 *   quest_point_photos — a random 24-hex id, the type (by the first bytes, never by what the app declared, like the
 *                        support chat's screenshots: services/bugReportStore.ts sniffImage), size, width × height
 *                        (services/imageSize.ts), who uploaded it and when.
 * A photo no point refers to is deleted a day after its upload (a photo added to a point that was then not saved, a
 * point removed, a photo taken off a point), so «Отменить» still finds it for a while. All photos together stay under
 * QUEST_POINT_PHOTO_STORAGE.maxStoredBytes (507 past it).
 */
export const QUEST_POINT_PHOTO_STORAGE = {
  maxStoredBytes: 500 * 1024 * 1024,
  /** An unreferenced photo is kept this long after its upload. */
  unusedMs: 24 * 60 * 60 * 1000,
} as const

export class QuestPointPhotoError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export interface QuestPointPhoto { id: string; mime: ImageMime; size: number; width: number; height: number }

const EXTENSION: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

interface Row { id: string; mime: string; size: number; width: number; height: number; created_by: string; created_at: number }

export class QuestPointPhotoStore {
  private readonly maxStoredBytes: number

  /**
   * `directory`: where the files go (created on the first upload). `referenced`: the photo ids the points show now
   * (services/questPointStore.ts), kept by the clean-up.
   */
  constructor(
    private readonly db: DatabaseSync,
    private readonly directory: string,
    private readonly referenced: () => Set<string>,
    private readonly options: { now?: () => number; maxStoredBytes?: number } = {},
  ) {
    this.maxStoredBytes = options.maxStoredBytes ?? QUEST_POINT_PHOTO_STORAGE.maxStoredBytes
    db.exec(`CREATE TABLE IF NOT EXISTS quest_point_photos (
        id TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS quest_point_photos_created ON quest_point_photos(created_at);`)
  }

  private now() { return this.options.now?.() ?? Date.now() }

  private path(id: string, mime: ImageMime) { return join(this.directory, `${id}.${EXTENSION[mime]}`) }

  /** Bytes of all stored photos. */
  storedBytes() {
    return Number((this.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM quest_point_photos').get() as { n: number }).n)
  }

  /** Whether a photo with this id is stored. */
  has(id: string) {
    return QUEST_POINT_PHOTO_ID.test(id) && Boolean(this.db.prepare('SELECT 1 FROM quest_point_photos WHERE id = ?').get(id))
  }

  /** Deletes the photos no point refers to that are older than QUEST_POINT_PHOTO_STORAGE.unusedMs; returns how many. */
  pruneUnused() {
    const keep = this.referenced()
    const old = this.db.prepare('SELECT id, mime FROM quest_point_photos WHERE created_at < ?').all(this.now() - QUEST_POINT_PHOTO_STORAGE.unusedMs) as Array<Pick<Row, 'id' | 'mime'>>
    let removed = 0
    for (const row of old) {
      if (keep.has(row.id)) continue
      this.db.prepare('DELETE FROM quest_point_photos WHERE id = ?').run(row.id)
      rmSync(this.path(row.id, row.mime as ImageMime), { force: true })
      removed += 1
    }
    return removed
  }

  /**
   * Stores one photo: 400 for an empty file, another type or an unreadable header, 413 over the size limit, 507 when
   * the storage is full. The file is written next to its final name first, then moved, so a half-written file is never
   * served.
   */
  upload(actor: string, data: Buffer): QuestPointPhoto {
    if (!data.length) throw new QuestPointPhotoError(400, 'Пустой файл')
    if (data.length > QUEST_POINT_PHOTO_LIMITS.fileBytes) throw new QuestPointPhotoError(413, 'Фото больше 5 МБ')
    const mime = sniffImage(data)
    if (!mime) throw new QuestPointPhotoError(400, 'Фото принимаются только в JPG, PNG или WEBP')
    const size = imageSize(data, mime)
    if (!size) throw new QuestPointPhotoError(400, 'Повреждённый файл фото')
    this.pruneUnused()
    if (this.storedBytes() + data.length > this.maxStoredBytes) throw new QuestPointPhotoError(507, 'Хранилище фото точек заполнено: уберите лишние фото')
    const id = randomBytes(12).toString('hex')
    const path = this.path(id, mime)
    mkdirSync(this.directory, { recursive: true })
    const partial = `${path}.${process.pid}-${Date.now()}.part`
    try {
      writeFileSync(partial, data, { mode: 0o640 })
      renameSync(partial, path)
    } catch (error) {
      rmSync(partial, { force: true })
      throw error
    }
    this.db.prepare('INSERT INTO quest_point_photos (id, mime, size, width, height, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, mime, data.length, size.width, size.height, actor, this.now())
    return { id, mime, size: data.length, ...size }
  }

  /** One photo with its bytes, or undefined (an unknown id, or its file is gone). */
  photo(id: string): (QuestPointPhoto & { data: Buffer }) | undefined {
    if (!QUEST_POINT_PHOTO_ID.test(id)) return undefined
    const row = this.db.prepare('SELECT id, mime, size, width, height FROM quest_point_photos WHERE id = ?').get(id) as Row | undefined
    if (!row) return undefined
    const mime = row.mime as ImageMime
    try {
      const data = readFileSync(this.path(row.id, mime))
      return { id: row.id, mime, size: Number(row.size), width: Number(row.width), height: Number(row.height), data }
    } catch {
      return undefined
    }
  }
}
