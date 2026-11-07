/**
 * The chat's stickers (owner, 07.11.2026: «найди паки смайликов и стикеров, и добавь их нам в чат, чтобы можно было стикеры в стиле
 * Таркова отправлять… смешные, не смешные, там с черным юмором»). Our own drawings (src/assets/stickers/<id>.svg), no game art: a
 * picture each, its caption drawn by the app in the reader's language. Shared by the server (only these ids are accepted) and the apps.
 */
export interface SupportSticker {
  id: string
  ru: string
  en: string
}

export const SUPPORT_STICKERS: readonly SupportSticker[] = [
  { id: 'rat', ru: 'Крыса', en: 'Rat' },
  { id: 'head-eyes', ru: 'Голова, глаза', en: 'Head, eyes' },
  { id: 'extract', ru: 'Я на выходе', en: 'At the extract' },
  { id: 'no-exit', ru: 'Выход закрыт', en: 'Extract closed' },
  { id: 'bush', ru: 'Сижу в кустах', en: 'In the bushes' },
  { id: 'lost-all', ru: 'Всё потерял', en: 'Lost it all' },
  { id: 'insurance', ru: 'Жду страховку', en: 'Waiting for insurance' },
  { id: 'fir', ru: 'Найдено в рейде', en: 'Found in raid' },
  { id: 'no-key', ru: 'Опять без ключа', en: 'No key again' },
  { id: 'heal', ru: 'Хилюсь', en: 'Healing' },
  { id: 'last-mag', ru: 'Последний магазин', en: 'Last mag' },
  { id: 'rip', ru: 'Ну всё, приехали', en: 'Well, that\'s it' },
  { id: 'thirsty', ru: 'Пить хочу', en: 'Need water' },
  { id: 'desync', ru: 'Десинхрон', en: 'Desync' },
  { id: 'gg', ru: 'GG', en: 'GG' },
  { id: 'thanks', ru: 'Спасибо, бро', en: 'Thanks, bro' },
]

export const SUPPORT_STICKER_IDS: ReadonlySet<string> = new Set(SUPPORT_STICKERS.map((sticker) => sticker.id))

export function supportSticker(id: string | undefined): SupportSticker | undefined {
  return id ? SUPPORT_STICKERS.find((sticker) => sticker.id === id) : undefined
}

/** The reactions offered on a message (owner, 07.11.2026: «смайлики или лайки можно было ставить на сообщения»). */
export const SUPPORT_REACTIONS: readonly string[] = ['👍', '❤️', '😂', '😮', '😢', '🔥', '💀', '🤝']
