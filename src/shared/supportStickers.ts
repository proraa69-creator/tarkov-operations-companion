/**
 * The chat's stickers, shared by the server (only these are accepted) and the apps.
 *
 * The built-in pack (owner, 08.11.2026: six of our own drawings kept — «Крыса», «Голова, глаза», «Жду страховку», «Найдено в
 * рейде», «Спасибо, бро», «Хилюсь»; the other ten went): a picture each (src/assets/stickers/<id>.svg), its caption drawn by
 * the app in the reader's language. It comes first in the picker.
 *
 * The owner's packs (owner, 07.11.2026: «в админ приложении на телефоне сделай мне функцию добавлять стикеры… И там я буду
 * делать паки стикеров. Которые по нажатию кнопки добавить будут добавляться в приложение на ПК и телефон»): made in the
 * iPhone admin (src/admin/stickers/), kept on the server (server/src/services/stickerStore.ts) and read by the apps when the
 * picker opens (src/support/stickerCatalog.ts). Their stickers are pictures only (a transparent PNG, words drawn in), with
 * a random id of 24 hex digits: never the same as a built-in one.
 */
export interface SupportSticker {
  id: string
  ru: string
  en: string
}

export const SUPPORT_STICKERS: readonly SupportSticker[] = [
  { id: 'rat', ru: 'Крыса', en: 'Rat' },
  { id: 'head-eyes', ru: 'Голова, глаза', en: 'Head, eyes' },
  { id: 'insurance', ru: 'Жду страховку', en: 'Waiting for insurance' },
  { id: 'fir', ru: 'Найдено в рейде', en: 'Found in raid' },
  { id: 'thanks', ru: 'Спасибо, бро', en: 'Thanks, bro' },
  { id: 'heal', ru: 'Хилюсь', en: 'Healing' },
]

/** The built-in stickers' ids. */
export const SUPPORT_STICKER_IDS: ReadonlySet<string> = new Set(SUPPORT_STICKERS.map((sticker) => sticker.id))

/** A built-in sticker; undefined for anything else (an owner's sticker too). */
export function supportSticker(id: string | undefined): SupportSticker | undefined {
  return id ? SUPPORT_STICKERS.find((sticker) => sticker.id === id) : undefined
}

/** The id of a sticker of the owner's packs (server/src/services/stickerStore.ts). */
export const OWNER_STICKER_ID = /^[a-f0-9]{24}$/
/** The id of an owner's pack. */
export const STICKER_PACK_ID = /^[a-f0-9]{24}$/

export const isOwnerStickerId = (id: unknown): id is string => typeof id === 'string' && OWNER_STICKER_ID.test(id)

/** A sticker id a message may carry: a built-in one or one of the owner's (whether it is published the server checks). */
export const isSupportStickerId = (id: unknown): id is string => typeof id === 'string' && (SUPPORT_STICKER_IDS.has(id) || OWNER_STICKER_ID.test(id))

/**
 * What the owner's stickers may be: a PNG (by its bytes) of at most `side` × `side` pixels and `bytes` bytes; at most `packs`
 * packs of at most `perPack` stickers each; a pack's name of 1–`name` characters. The editor saves `side` × `side`.
 */
export const STICKER_LIMITS = { side: 512, bytes: 512 * 1024, packs: 50, perPack: 120, name: 40 } as const

/** The published packs as every app reads them (GET /v1/stickers): `version` changes whenever any of it does. */
export interface StickerCatalogSticker { id: string; width: number; height: number }
export interface StickerCatalogPack { id: string; name: string; stickers: StickerCatalogSticker[] }
export interface StickerCatalog { version: string; updatedAt: string | null; packs: StickerCatalogPack[] }

/** The address of an owner's sticker picture (server/src/routes/stickers.ts): the same picture for ever. */
export const stickerImagePath = (id: string) => `/v1/stickers/${id}.png`

/** The reactions offered on a message (owner, 07.11.2026: «смайлики или лайки можно было ставить на сообщения»). */
export const SUPPORT_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🔥', '💀', '🤝']
