/**
 * The owner's published sticker packs in the apps' picker (owner, 07.11.2026: «Которые по нажатию кнопки добавить будут
 * добавляться в приложение на ПК и телефон… чтобы по нажатию паки загружались»): read from the server (GET /v1/stickers,
 * server/src/routes/stickers.ts) through the same whitelisted gateway as the chat (electron/serviceGateway.ts on the PC,
 * sync/webAccount.ts on the phone and the iPhone admin), so a new pack needs no app update.
 *
 * One copy for the whole app, kept on this device too (shown at once next time): the picker asks again when it opens
 * (at most once a minute), and the copy is replaced only when the server's `version` moved. The pictures come from the
 * server's picture route (`stickerPictureSrc`), which the apps keep for a year (a sticker's id never shows another
 * picture); the built-in ones are in the app (support/stickers.ts).
 */
import { useEffect, useSyncExternalStore } from 'react'
import { serviceClient } from '../account/nicknameBinding'
import { isOwnerStickerId, STICKER_LIMITS, STICKER_PACK_ID, stickerImagePath, type StickerCatalog, type StickerCatalogPack } from '../shared/supportStickers'
import { cleanIpcError, currentServerStatus } from '../sync/serverSync'
import { apiBaseUrl } from '../sync/webAccount'
import { stickerPictureUrl } from './stickers'

export const STICKER_CATALOG_PATH = '/v1/stickers'
const STORAGE_KEY = 'raidos-sticker-catalog-v1'
/** The picker opened again within this long: no new request. */
export const STICKER_CATALOG_FRESH_MS = 60_000
const DEFAULT_SERVER = 'https://raidos.app'

const pixels = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= STICKER_LIMITS.side ? value : 0)

/** The server's answer, shape-checked: broken packs and stickers are left out (null for no answer at all). */
export function cleanStickerCatalog(raw: unknown): StickerCatalog | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!value || typeof value.version !== 'string' || !value.version || value.version.length > 64 || !Array.isArray(value.packs)) return null
  const packs = value.packs.flatMap((entry): StickerCatalogPack[] => {
    const pack = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null
    if (!pack || typeof pack.id !== 'string' || !STICKER_PACK_ID.test(pack.id) || typeof pack.name !== 'string' || !pack.name.trim() || !Array.isArray(pack.stickers)) return []
    const stickers = pack.stickers.flatMap((item) => {
      const sticker = item && typeof item === 'object' ? item as Record<string, unknown> : null
      const width = pixels(sticker?.width)
      const height = pixels(sticker?.height)
      return sticker && isOwnerStickerId(sticker.id) && width && height ? [{ id: sticker.id, width, height }] : []
    }).slice(0, STICKER_LIMITS.perPack)
    return stickers.length ? [{ id: pack.id, name: pack.name.trim().slice(0, STICKER_LIMITS.name * 2), stickers }] : []
  }).slice(0, STICKER_LIMITS.packs)
  return { version: value.version, updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null, packs }
}

function stored(): StickerCatalog | null {
  try { return cleanStickerCatalog(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

function store(catalog: StickerCatalog) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog)) } catch { /* storage unavailable: read again next time */ }
}

export interface StickerCatalogState {
  catalog: StickerCatalog | null
  loading: boolean
  /** Why the last read failed ('' when it did not); the built-in pack and the kept copy stay. */
  error: string
}

let state: StickerCatalogState = { catalog: stored(), loading: false, error: '' }
let readAt = 0
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()
const set = (next: Partial<StickerCatalogState>) => { state = { ...state, ...next }; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Forgets the copy (tests). */
export function resetStickerCatalog() {
  inflight = null
  readAt = 0
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* nothing kept */ }
  set({ catalog: null, loading: false, error: '' })
}

/**
 * Reads the published packs (concurrent calls share one request); within STICKER_CATALOG_FRESH_MS of the last read only
 * with `force`. The copy is replaced only when the version moved.
 */
export function loadStickerCatalog(force = false): Promise<void> {
  if (inflight) return inflight
  if (!force && readAt && Date.now() - readAt < STICKER_CATALOG_FRESH_MS) return Promise.resolve()
  const request = serviceClient()
  if (!request) return Promise.resolve()
  set({ loading: true })
  inflight = (async () => {
    try {
      const catalog = cleanStickerCatalog(await request('GET', STICKER_CATALOG_PATH))
      if (!catalog) throw new Error('Сервер вернул неожиданный ответ')
      readAt = Date.now()
      if (catalog.version !== state.catalog?.version) store(catalog)
      set({ loading: false, error: '', ...(catalog.version !== state.catalog?.version ? { catalog } : {}) })
    } catch (error) {
      set({ loading: false, error: cleanIpcError(error) || 'Сервер недоступен' })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

/** The published packs (the kept copy at once); `open`: the picker is open, so they are read again if stale. */
export function useStickerCatalog(open: boolean) {
  const current = useSyncExternalStore(subscribe, () => state, () => state)
  useEffect(() => { if (open) void loadStickerCatalog() }, [open])
  return { packs: current.catalog?.packs ?? [], loading: current.loading, error: current.error, reload: () => loadStickerCatalog(true) }
}

/** The server the owner's stickers live on: the PC's account server, the phone's API address. */
export function stickerServerOrigin() {
  const desktop = typeof window !== 'undefined' && Boolean(window.tarkovDesktop?.serviceRequest)
  const raw = desktop ? currentServerStatus()?.serverUrl : apiBaseUrl()
  try {
    const url = new URL(raw ?? '')
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
  } catch { /* the default below */ }
  return DEFAULT_SERVER
}

/** A sticker's picture: a built-in one from the app, an owner's from the server; undefined for an unknown id. */
export function stickerPictureSrc(id: string): string | undefined {
  if (isOwnerStickerId(id)) return `${stickerServerOrigin()}${stickerImagePath(id)}`
  return stickerPictureUrl(id)
}
