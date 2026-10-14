/**
 * The owner's notice in two languages (owner, 14.10.2026: «а блок с уведомлением, я буду писать по русски, все кто с снг
 * уведомление будет на русском и не известные страны тоже на русском, а все иностранные у них этот текст будет
 * автоматически переводится на английский»). The owner writes Russian only; the English is made once, when the notice is
 * saved (MyMemory, free, no key), and every reader gets one of the two by their country (routes/announcement.ts).
 */
import type { CountryCode } from '../../../src/shared/countries'

/**
 * The countries that read the notice in Russian; an unknown country reads it in Russian too, every other country in
 * English. Not the admin panel's «СНГ» (CIS_COUNTRIES in src/shared/countries.ts, where Ukraine is Europe and Georgia
 * another country): here both read Russian. A country moves by adding or removing its code here.
 */
export const RUSSIAN_NOTICE_COUNTRIES: readonly CountryCode[] = ['RU', 'BY', 'KZ', 'KG', 'TJ', 'UZ', 'AM', 'AZ', 'MD', 'TM', 'UA', 'GE']

export type NoticeLanguage = 'ru' | 'en'

/** The reader's language by their country (two letters; undefined when unknown). */
export function noticeLanguage(country: string | undefined): NoticeLanguage {
  return !country || (RUSSIAN_NOTICE_COUNTRIES as readonly string[]).includes(country) ? 'ru' : 'en'
}

const CYRILLIC = /[Ѐ-ӿ]/g
const LATIN = /[a-z]/gi

/** Mostly Russian letters (true), mostly Latin ones (false), or neither (times, emoji): undefined. */
function russianScript(text: string) {
  const cyrillic = text.match(CYRILLIC)?.length ?? 0
  const latin = text.match(LATIN)?.length ?? 0
  return cyrillic === latin ? undefined : cyrillic > latin
}

/** Any Russian letter: a text without one has nothing to translate. */
export const hasRussian = (text: string) => /[Ѐ-ӿ]/.test(text)

/** A translation still in Russian (the service gave the text back): no English. */
export const stillRussian = (text: string) => russianScript(text) === true

/**
 * A notice written the old way (13.10.2026): a Russian paragraph and an English one with an empty line between them,
 * classified as the apps did it (announcementForLocale in src/announcement/announcement.ts). Its Russian paragraphs and
 * its English ones; a paragraph in neither alphabet goes to both. Undefined for a notice in one language.
 */
export function splitBilingualNotice(text: string): { ru: string; en: string } | undefined {
  const paragraphs = text.split(/\n[ \t]*\n+/).map((part) => part.trim()).filter(Boolean)
  const scripts = paragraphs.map(russianScript)
  if (!scripts.includes(true) || !scripts.includes(false)) return undefined
  const pick = (russian: boolean) => paragraphs.filter((_, index) => scripts[index] === undefined || scripts[index] === russian).join('\n\n')
  return { ru: pick(true), en: pick(false) }
}

/** Russian → English: the English, or a rejection (network, timeout, quota, an empty answer). */
export type AnnouncementTranslator = (russian: string) => Promise<string>

/** MyMemory's free API (https://mymemory.translated.net/doc/spec.php): no key, no e-mail, a query of up to ~500 bytes. */
export const MYMEMORY_URL = 'https://api.mymemory.translated.net/get'
/** UTF-8 bytes per query, under MyMemory's limit with room to spare (a Russian letter takes 2). */
export const TRANSLATION_CHUNK_BYTES = 450
export const TRANSLATION_TIMEOUT_MS = 8_000

const utf8 = (value: string) => Buffer.byteLength(value, 'utf8')

/** A piece of the text and what followed it there (a line break, an empty line, a space), put back after its English. */
export interface TranslationChunk { text: string; after: string }

// Where a piece may be cut, best first: line breaks (an empty line included), sentence ends, spaces.
const CUTS = [/(\s*\n\s*)/, /(?<=[.!?…])(\s+)/, /(\s+)/]

/** The pieces of a trimmed text, each at most `limit` bytes; a word longer than that is cut between its letters. */
function pieces(text: string, after: string, level: number, limit: number): TranslationChunk[] {
  if (utf8(text) <= limit) return [{ text, after }]
  const out: TranslationChunk[] = []
  if (level === CUTS.length) {
    let current = ''
    for (const char of text) {
      if (current && utf8(current + char) > limit) { out.push({ text: current, after: '' }); current = '' }
      current += char
    }
    return [...out, { text: current, after }]
  }
  const parts = text.split(CUTS[level]!)
  for (let index = 0; index < parts.length; index += 2) {
    const next = index + 1 < parts.length ? parts[index + 1]! : after
    if (parts[index]) out.push(...pieces(parts[index]!, next, level + 1, limit))
    else if (out.length) out[out.length - 1]!.after += next
  }
  return out
}

/**
 * The text in queries of at most `limit` UTF-8 bytes, cut at line breaks first, then at sentence ends, then at spaces;
 * as many whole pieces per query as fit. Every chunk's text followed by its `after` gives the trimmed text back.
 */
export function translationChunks(text: string, limit = TRANSLATION_CHUNK_BYTES): TranslationChunk[] {
  const chunks: TranslationChunk[] = []
  for (const piece of pieces(text.trim(), '', 0, limit)) {
    const last = chunks.at(-1)
    if (!last || utf8(last.text + last.after + piece.text) > limit) { chunks.push({ ...piece }); continue }
    last.text += last.after + piece.text
    last.after = piece.after
  }
  return chunks
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

/** MyMemory answers with an HTML entity now and then («It&#39;s»). */
function decodeEntities(text: string) {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|(amp|lt|gt|quot|apos));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? whole
    const code = decimal ? Number(decimal) : parseInt(hex ?? '', 16)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
  })
}

interface MyMemoryAnswer { responseData?: { translatedText?: unknown }; responseStatus?: unknown; quotaFinished?: unknown }

/**
 * The automatic English through MyMemory (`?q=<text>&langpair=ru|en`). Its line breaks survive the translation
 * (checked live, 14.10.2026), the chunks' own separators are put back here. All chunks are asked at once and each at
 * most `timeoutMs`: the owner app waits 15 s for the save (electron/serviceGateway.ts). An HTTP error, the daily quota
 * («MYMEMORY WARNING…», quotaFinished), another status or an empty answer rejects. `fetch` for the tests.
 */
export function myMemoryTranslator(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): AnnouncementTranslator {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? TRANSLATION_TIMEOUT_MS
  const translate = async (text: string) => {
    const response = await fetcher(`${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=ru|en`, {
      headers: { accept: 'application/json', 'user-agent': 'RaidOS-notice/1 (+https://raidos.app)' },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`MyMemory: HTTP ${response.status}`)
    const answer = await response.json() as MyMemoryAnswer | null
    const translated = typeof answer?.responseData?.translatedText === 'string' ? decodeEntities(answer.responseData.translatedText).trim() : ''
    if (answer?.quotaFinished === true || /MYMEMORY WARNING/i.test(translated)) throw new Error('MyMemory: the free daily quota is used up')
    if (Number(answer?.responseStatus) !== 200) throw new Error(`MyMemory: status ${Number(answer?.responseStatus)}`)
    if (!translated) throw new Error('MyMemory: empty answer')
    return translated
  }
  return async (russian) => {
    const chunks = translationChunks(russian)
    if (!chunks.length) throw new Error('MyMemory: nothing to translate')
    const english = await Promise.all(chunks.map((chunk) => translate(chunk.text)))
    return english.map((text, index) => text + chunks[index]!.after).join('')
  }
}
