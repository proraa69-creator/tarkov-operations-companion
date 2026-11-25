/**
 * The nickname's glyphs checked by their shapes (owner, 25.11.2026: «цифры не читает корректно, научись правильно читать,
 * разделять, где цифра, а где буква»). The game writes the nickname in its Bender font, whose «0» is slashed: Tesseract
 * reads it «O», «2», «8», «a», «d» or «G» (a nickname like «X0rk_Bat60» came «XOrk_Bat62», «XGrk_Bat6a»). The slashed
 * zero's ink is like no letter's — two enclosed areas side by side along its slash (levelDigits.ts classifyDigit) — so a
 * glyph with that ink is the digit «0» whatever the OCR said. A digit the OCR read is the digit its shape shows when that
 * shape is a clear one; a «0» the OCR read on a plain round glyph (one enclosed area in its middle, no slash) is the
 * letter O. Every other letter stays as read: letters are never guessed from shapes.
 *
 * `zeros` tells, letter by letter, what the shapes proved: «0» a slashed zero, «o» a round letter that is no zero, «.»
 * nothing (src/import/modeSelectScreen.ts screenNickname keeps a known spelling but for these).
 */
import { classifyDigit, coverage, holes, inkParts, partMask, type GlyphMask, type GrayPicture, type InkGlyph, type InkParts, type PixelBox } from './levelDigits.js'

/** One character of a Tesseract word (its `blocks` output), with its box. */
export interface OcrSymbol { text: string; bbox: PixelBox }
/** A Tesseract word with its characters. */
export interface OcrWordWithSymbols { text: string; bbox: PixelBox; symbols?: OcrSymbol[] }
/** A nickname after its glyphs were checked, and what each of its letters' shapes proved. */
export interface CheckedName { nickname: string; zeros: string }

const NICKNAME = /^[A-Za-z0-9_-]{3,15}$/

/** The letter O (or o): one enclosed area in its middle, strokes on both sides above and below it, no slash. */
function roundLetter(mask: GlyphMask) {
  const aspect = mask.width / mask.height
  if (mask.height < 9 || aspect < 0.55 || aspect > 1.3) return false
  const areas = holes(mask)
  if (areas.length !== 1) return false
  const area = areas[0]!
  if (area.x < 0.3 || area.x > 0.7 || area.y < 0.3 || area.y > 0.7) return false
  return Math.min(coverage(mask, 0.15, 0.42, 0, 0.3), coverage(mask, 0.15, 0.42, 0.7, 1), coverage(mask, 0.58, 0.85, 0, 0.3), coverage(mask, 0.58, 0.85, 0.7, 1)) >= 0.2
}

/** The part of the ink under a symbol: the one most of the symbol's columns cover; `clean` when it lies mostly inside them. */
function partUnder(parts: InkParts, box: PixelBox): { glyph: InkGlyph; clean: boolean } | undefined {
  const x0 = box.x0 - parts.x0, x1 = box.x1 - parts.x0
  const width = Math.max(1, x1 - x0 + 1)
  let best: InkGlyph | undefined, bestOver = 0
  for (const glyph of parts.glyphs) {
    // Specks, the dot of an «i», a scratch of the art: no letter.
    if (glyph.pixels < 6) continue
    const over = Math.max(0, Math.min(glyph.x1, x1) - Math.max(glyph.x0, x0) + 1)
    if (over > bestOver || (over === bestOver && best && glyph.pixels > best.pixels)) { bestOver = over; best = glyph }
  }
  if (!best || bestOver < width * 0.5) return undefined
  return { glyph: best, clean: bestOver >= (best.x1 - best.x0 + 1) * 0.7 }
}

/**
 * `nickname` as it stands in `word` (the close-up's word holding it), each of its glyphs checked by its shape (see above).
 * Two characters the OCR read on one slashed zero («Kat62a» for «Kat60») are one «0». Null when the word cannot be checked
 * (no symbols, too little contrast) or the checked name is no nickname of the game.
 */
export function checkNameGlyphs(picture: GrayPicture, word: OcrWordWithSymbols, nickname: string): CheckedName | null {
  const chars = [...word.text]
  const symbols = word.symbols ?? []
  const start = word.text.indexOf(nickname)
  // The close-up's whitelist keeps the word Latin: one UTF-16 unit a character, so the text index is the symbols' index.
  if (!nickname || start < 0 || symbols.length !== chars.length || chars.length !== word.text.length) return null
  const parts = inkParts(picture, word.bbox)
  if (!parts) return null
  // The line's capital height: an O stands as tall, an o lower.
  const capital = Math.max(0, ...parts.glyphs.filter((glyph) => glyph.pixels >= 6).map((glyph) => glyph.y1 - glyph.y0 + 1))
  const shapes = new Map<InkGlyph, number | null>()
  const digitOf = (glyph: InkGlyph) => {
    if (!shapes.has(glyph)) shapes.set(glyph, classifyDigit(partMask(parts, glyph)))
    return shapes.get(glyph)!
  }
  let text = '', zeros = ''
  let zeroBefore: InkGlyph | undefined
  for (let index = start; index < start + nickname.length; index += 1) {
    const char = chars[index]!
    const under = partUnder(parts, symbols[index]!.bbox)
    if (under && digitOf(under.glyph) === 0) {
      // The slashed zero; the same glyph read twice is one zero.
      if (under.glyph !== zeroBefore) { text += '0'; zeros += '0' }
      zeroBefore = under.glyph
      continue
    }
    zeroBefore = undefined
    if (!under?.clean) { text += char; zeros += '.'; continue }
    const digit = digitOf(under.glyph)
    if (/[0-9]/.test(char) && digit !== null) { text += String(digit); zeros += '.'; continue }
    const mask = partMask(parts, under.glyph)
    if (/[0Oo]/.test(char) && roundLetter(mask)) {
      text += char !== '0' ? char : mask.height >= capital * 0.85 ? 'O' : 'o'
      zeros += 'o'
      continue
    }
    text += char
    zeros += '.'
  }
  return NICKNAME.test(text) && /[A-Za-z]/.test(text) ? { nickname: text, zeros } : null
}
