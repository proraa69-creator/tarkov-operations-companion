import type { Item } from '../domain/types'
import { levenshtein, normalizeOcr, partialSimilarity } from '../overlay/itemMatch'

/**
 * How surely an item's stash label shows in the OCR text of the Collector scan (0–1). Stash labels are short names,
 * misread in a few typical ways (measured on the owner's container screenshot, 12.10.2026):
 *   - cut to the cell («#FireKlea» for «#FireKlean», a one-cell item);
 *   - one letter off, often a Cyrillic / Latin look-alike («Macno» for «Масло», «toot Lord» for «Loot Lord»);
 *   - a stray mark glued on («eYMXC|»);
 *   - two letters long («Яд», «WZ»), which only a whole word may match.
 * Only the Collector's own items are matched, so these allowances do not reach unrelated labels.
 */
export function labelScore(item: Pick<Item, 'shortName'>, text: string): number {
  const plain = normalizeOcr(item.shortName ?? '')
  // A name of digits alone («42») would match the counts on screen («42/60»): left to the manual tick.
  if (!plain || /^\d+$/.test(plain)) return 0
  // Names of two or three letters («Яд», «Усы», «VHS», «КШС») only as a whole word.
  const short = plain.length <= 3
  const name = labelFold(item.shortName ?? '', !short)
  let best = 0
  for (const line of text.split(/\r?\n/).map((value) => labelFold(value, !short)).filter(Boolean)) {
    if (name.includes(' ')) {
      // The line that is the whole label, word for word: above any one of its words («TK FAST MT» is a helmet, «FAST» a
      // visor, «FAST MT» another helmet). Within a longer line, as below.
      if (line === name) { best = Math.max(best, 0.97); continue }
      // «Loot Lord», «BEAR Buddy»: the words read together, one or two letters off.
      if (line.length >= name.length * 0.7) best = Math.max(best, partialSimilarity(name, line) >= 0.8 ? 0.82 : 0)
      continue
    }
    for (const word of line.split(' ')) {
      if (word === name) { best = Math.max(best, 0.9); continue }
      if (short) continue
      const distance = levenshtein(word, name)
      // One letter off: for short names only a swapped letter («Macno»), never a missing one («Axe» is not «Axel»).
      if (distance === 1 && (word.length === name.length || name.length >= 6)) best = Math.max(best, 0.8)
      else if (distance === 2 && name.length >= 8) best = Math.max(best, 0.78)
      // Cut to the cell: the start of the name, most of it.
      if (word.length >= Math.max(5, name.length - 3) && word.length < name.length && levenshtein(word, name.slice(0, word.length)) <= (word.length >= 7 ? 1 : 0)) best = Math.max(best, 0.8)
      // A stray mark glued to it.
      if (word.length - name.length <= 2 && word.length > name.length && word.includes(name)) best = Math.max(best, 0.8)
    }
  }
  return best
}

/**
 * Both sides of labelScore, with the letters Tesseract reads for others on stash labels folded together (measured on the
 * owner's stash frames, 19.11.2026: «опять не нашёл КШС»): Ш and Щ as «LU», «LLI», «L» or W («KLUC», «KWC», «KLC» for
 * «КШС»), 1 as l or i («Survil2» for «Surv12»), Э and З as 3 («3KO» for «ЭКО»), й as и («ЯИЦО»), п as n («nep.»), г as r,
 * Ы as «bI», Ь as b. Over normalizeOcr (Cyrillic and Latin look-alikes already one). `ones`: 1 and i as l too — not for
 * the names of two or three letters, where «II» of «PM II 3-20x50» would be the syringe «L1».
 */
export function labelFold(value: string, ones = true) {
  const folded = normalizeOcr(value)
    .replace(/[шщw]/g, 'l')
    .replace(/й/g, 'и')
    .replace(/ы/g, 'bl')
    .replace(/ь/g, 'b')
    .replace(/[эз]/g, '3')
    .replace(/п/g, 'n')
    .replace(/г/g, 'r')
  return (ones ? folded.replace(/[1i]/g, 'l') : folded).replace(/l[lu]+/g, 'l')
}
