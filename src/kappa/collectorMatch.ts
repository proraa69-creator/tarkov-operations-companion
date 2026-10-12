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
  const name = normalizeOcr(item.shortName ?? '')
  // A name of digits alone («42») would match the counts on screen («42/60»): left to the manual tick.
  if (!name || /^\d+$/.test(name)) return 0
  let best = 0
  for (const line of text.split(/\r?\n/).map(normalizeOcr).filter(Boolean)) {
    if (name.includes(' ')) {
      // «Loot Lord», «BEAR Buddy»: the words read together, one or two letters off.
      if (line.length >= name.length * 0.7) best = Math.max(best, partialSimilarity(name, line) >= 0.8 ? 0.82 : 0)
      continue
    }
    for (const word of line.split(' ')) {
      if (word === name) { best = Math.max(best, 0.9); continue }
      // Names of two or three letters («Яд», «Усы», «VHS») only as a whole word.
      if (name.length <= 3) continue
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
