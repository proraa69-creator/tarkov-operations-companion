/**
 * A line under a point's title that only says the title again (owner, 08.11.2026, a key's tooltip: «Ключ от помещения с
 * телами» / «Ключ от помещения с телами» / «Открывает помещение с телами.» — «Дублирующие надписи снизу удали везде, если они
 * дублируются… чтобы только одна надпись вот выше была»): every word of it that tells something is in the title already.
 * «Открывает», «ключ» and the small words tell nothing here; a word is the title's when the start of it is (помещение /
 * помещения). A line with one word of its own («Трупы», a floor, a price) stays.
 */
const SAYS_NOTHING = new Set([
  'с', 'со', 'от', 'в', 'во', 'на', 'и', 'к', 'по', 'из', 'для', 'за', 'у',
  'открывает', 'открыть', 'ключ', 'ключом',
  'a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'with', 'opens', 'open', 'key',
])
const STEM = 5

const words = (text: string) => text.toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const stem = (word: string) => word.slice(0, STEM)

export function repeatsTitle(line: string | undefined | null, title: string | undefined | null): boolean {
  if (!line || !title) return false
  const own = words(line).filter((word) => !SAYS_NOTHING.has(word))
  if (!own.length) return words(line).length > 0 && words(title).length > 0
  const titled = new Set(words(title).map(stem))
  return own.every((word) => titled.has(stem(word)))
}
