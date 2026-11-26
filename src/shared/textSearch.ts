/**
 * Search by words (a player, 23.11.2026: the item search «не находит SJ1 боевой стимулятор и SJ12 боевой стимулятор» — the item
 * is «Боевой стимулятор SJ1 TGLabs», and the query was looked for as one piece, so another word order found nothing).
 *
 * Every word of the query must be in the text, in any order; a Russian word is matched without its ending («боевой» finds
 * «боевым», «стимуляторы» finds «стимулятор»). Whatever the old whole-query match found, this finds too.
 */

/** Lower case, «ё» as «е», quotes, brackets and commas as spaces. */
export function foldSearchText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„()[\]{},;:!?]/g, ' ')
}

/** The endings cut from a Russian word of the query, longest first. */
const RUSSIAN_ENDINGS = [
  'ыми', 'ими', 'ого', 'его', 'ому', 'ему', 'ами', 'ями',
  'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ым', 'им', 'ую', 'юю', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев',
  'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
]

/** A query word as it is looked for: a Cyrillic word of five letters or more without its ending, its stem four letters at least. */
function searchStem(word: string): string {
  if (word.length < 5 || !/^[а-я-]+$/.test(word)) return word
  const ending = RUSSIAN_ENDINGS.find((end) => word.endsWith(end) && word.length - end.length >= 4)
  return ending ? word.slice(0, -ending.length) : word
}

/** The query's words as they are looked for (none for an empty query). */
export function searchTerms(query: string): string[] {
  return foldSearchText(query).split(/\s+/).filter(Boolean).map(searchStem)
}

/** Every word of the query is in one of the texts taken together (an empty query matches everything). */
export function matchesSearchTerms(terms: readonly string[], ...texts: ReadonlyArray<string | undefined | null>): boolean {
  if (!terms.length) return true
  const haystack = foldSearchText(texts.filter(Boolean).join(' '))
  return terms.every((term) => haystack.includes(term))
}

/** `matchesSearchTerms` for a query typed as it is. */
export function matchesSearchQuery(query: string, ...texts: ReadonlyArray<string | undefined | null>): boolean {
  return matchesSearchTerms(searchTerms(query), ...texts)
}
