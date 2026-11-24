/**
 * Japanese and Chinese text as the OCR gives it (the game in Japanese or Simplified Chinese, src/import/gameLanguage.ts).
 * Tesseract's Japanese and Chinese models put a space between characters («任 意 地 点» for «任意地点») and make a word of
 * each character; and one character says as much as several Latin or Cyrillic letters, so lengths are weighed. Korean
 * (Hangul) keeps its spaces between words, but a syllable is weighed like a character too, and the item matchers squeeze
 * the spaces beside it. Text without such characters passes through every function here unchanged.
 */

/** Chinese characters, Japanese kana (and the long vowel mark), half-width kana. */
const CJK_LETTER = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u30fc\\uff66-\\uff9f'
/** Their punctuation and full-width forms («（你）», «：», «！»). */
const CJK_MARK = '\\u3000-\\u303f\\uff01-\\uff0f\\uff1a-\\uff20\\uff3b-\\uff40\\uff5b-\\uff65'
const CJK_ANY = `[${CJK_LETTER}${CJK_MARK}]`

export const CJK_CHAR = new RegExp(`[${CJK_LETTER}]`, 'u')
const CJK_CHARS = new RegExp(`[${CJK_LETTER}]`, 'gu')
const SPACED = new RegExp(`(${CJK_ANY})[ \\t]+(?=${CJK_ANY})`, 'gu')
const STARTS = new RegExp(`^${CJK_ANY}`, 'u')
const ENDS = new RegExp(`${CJK_ANY}$`, 'u')

export const hasCjk = (text: string) => CJK_CHAR.test(text)

/**
 * The Turkish i in one form: «İ» and «ı» as «i» (lower-casing «İ» leaves an «i» and a combining dot, which the matchers
 * would take for a space; the OCR reads ı and i for each other). Text without them stays as it is.
 */
export function foldTurkishI(text: string) {
  return /[İı]/.test(text) ? text.replace(/İ/g, 'I').replace(/ı/g, 'i') : text
}

/** Korean syllables (and the letters they are made of). */
export const HANGUL_CHAR = /\p{Script=Hangul}/u
const HANGUL_CHARS = /\p{Script=Hangul}/gu
export const hasHangul = (text: string) => HANGUL_CHAR.test(text)
const WIDE_ANY = `[${CJK_LETTER}${CJK_MARK}\\p{Script=Hangul}]`

/** The spaces the OCR put between Japanese or Chinese characters taken out («任 意 地 点» → «任意地点»). */
export function joinCjkSpaces(text: string) {
  return hasCjk(text) ? text.replace(SPACED, '$1') : text
}

const NEXT_TO_CJK = new RegExp(`(?<=${WIDE_ANY})\\s+|\\s+(?=${WIDE_ANY})`, 'gu')

/**
 * Spaces beside any Japanese, Chinese or Korean character taken out: «M4A1 アサルトライフル» and the OCR's
 * «M4A1アサルトライフル», «GPU 그래픽 카드» and «GPU그래픽카드» are the same name to the item matchers. Text without such
 * characters stays as it is.
 */
export function squeezeCjkSpaces(text: string) {
  return hasCjk(text) || hasHangul(text) ? text.replace(NEXT_TO_CJK, '') : text
}

/**
 * How many letters a text counts as for the readers' length limits: a Chinese character, a kana or a Korean syllable as
 * two (a two-character Chinese title, «데뷔», names as much as a Latin word of four or five letters).
 */
export function letterWeight(text: string) {
  const cjk = hasCjk(text), hangul = hasHangul(text)
  if (!cjk && !hangul) return text.length
  return text.length + (cjk ? text.match(CJK_CHARS)?.length ?? 0 : 0) + (hangul ? text.match(HANGUL_CHARS)?.length ?? 0 : 0)
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/**
 * Two neighbouring words of a line are one run of characters when the gap between them is narrower than this share of the
 * line's height: the OCR's spaces between the characters of a word are a sliver, a column's gap is wide.
 */
const CHARACTER_GAP = 0.6
/**
 * Korean puts spaces between words, narrower than a column's gap: syllables the OCR made words of («프 라 퍼» for
 * «프라퍼») stand closer than this share of the line's height (a third of it on the pictures of
 * scripts/ocr/language-fixtures.mjs, a space between words three fifths).
 */
const SYLLABLE_GAP = 0.45

const HANGUL_END = /\p{Script=Hangul}$/u
const HANGUL_START = /^\p{Script=Hangul}/u

/**
 * The words of one OCR line with each run of Japanese or Chinese characters, or of Korean syllables, made one word again
 * (the OCR makes a word of every character, now and then of a syllable): their texts joined, their boxes put together.
 * Words further apart (another word of Korean, another cell of a table) and other words stay as they are.
 */
export function joinCjkWords<T extends { text: string; bbox: Box }>(words: readonly T[]): T[] {
  if (!words.some((word) => hasCjk(word.text) || hasHangul(word.text))) return [...words]
  const out: T[] = []
  for (const word of words) {
    const last = out.at(-1)
    const height = last ? Math.max(last.bbox.y1 - last.bbox.y0, word.bbox.y1 - word.bbox.y0, 1) : 1
    const gap = last ? word.bbox.x0 - last.bbox.x1 : Infinity
    const cjk = last && ENDS.test(last.text.trim()) && STARTS.test(word.text.trim()) && gap <= height * CHARACTER_GAP
    const hangul = last && HANGUL_END.test(last.text.trim()) && HANGUL_START.test(word.text.trim()) && gap <= height * SYLLABLE_GAP
    if (last && (cjk || hangul)) {
      out[out.length - 1] = {
        ...last,
        text: `${last.text.trim()}${word.text.trim()}`,
        bbox: { x0: Math.min(last.bbox.x0, word.bbox.x0), y0: Math.min(last.bbox.y0, word.bbox.y0), x1: Math.max(last.bbox.x1, word.bbox.x1), y1: Math.max(last.bbox.y1, word.bbox.y1) },
      }
    } else out.push(word)
  }
  return out
}

type Blocks = Array<{ paragraphs: Array<{ lines: Array<{ words: Array<{ text: string; bbox: Box }> }> }> }> | null | undefined

/**
 * The text of a Japanese or Chinese reading rebuilt from its word boxes: each line's runs of characters joined, the words
 * of different cells (a wide gap) kept apart by a space — the plain text has one space everywhere and would glue a table's
 * cells together. Null when there are no boxes.
 */
export function cjkBlocksText(blocks: Blocks): string | null {
  if (!blocks?.length) return null
  return blocks.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => joinCjkWords(line.words).map((word) => word.text.trim()).filter(Boolean).join(' '))))
    .join('\n')
}
