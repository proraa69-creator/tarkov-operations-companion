/**
 * Every English text the app shows, for the German, Japanese and Chinese phrase files (src/i18n/locales/<lang>.json):
 * the interface dictionary (src/i18n/uiEnglish*.ts, with its templates) and the English written right in the screens and
 * data (`locale === 'en' ? 'Close' : 'Закрыть'`, `{ ru: …, en: … }`, `"en": …` in the JSON data).
 *
 *   npx jiti scripts/i18n/extract-english.ts <out.json>
 *
 * Writes a sorted list of the distinct texts; scripts/i18n/missing.ts compares it with a language's file.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { englishUiTexts } from '../../src/i18n/uiEnglish'

const root = join(__dirname, '..', '..')
const CYRILLIC = /[А-Яа-яЁё]/
const LATIN_WORD = /[A-Za-z]{2,}/

function files(folder: string, out: string[] = []) {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name)
    if (name === 'node_modules' || name === '__fixtures__' || name === 'locales') continue
    if (statSync(path).isDirectory()) files(path, out)
    else if (/\.(tsx?|json)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

/** A string literal's text: '…', "…" or `…` without ${}. */
const LITERAL = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|\x60((?:[^\x60\\$]|\\.)*)\x60)`
const unescape = (text: string) => text.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1')
const literal = (match: RegExpExecArray, at: number) => unescape(match[at] ?? match[at + 1] ?? match[at + 2] ?? '')

const texts = new Set<string>()
const add = (text: string) => {
  const value = text.trim()
  if (!value || CYRILLIC.test(value) || !LATIN_WORD.test(value)) return
  if (/^(https?:|\/|\.|#|[a-z]+[-_][a-z-_]+$|[a-z]+(?:[A-Z][a-z]+)+$)/.test(value)) return
  texts.add(value)
}

for (const text of englishUiTexts()) add(text)

const pairs = [
  // 'English' : 'Русский' and 'Русский' : 'English' (ternaries on the language)
  new RegExp(`${LITERAL}\\s*:\\s*${LITERAL}`, 'g'),
  // { en: '…' } / en: "…"
  new RegExp(String.raw`\ben\s*:\s*${LITERAL}`, 'g'),
]
for (const path of files(join(root, 'src'))) {
  if (path.includes(join('src', 'i18n', 'uiEnglish'))) continue
  const source = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) {
    for (const match of source.matchAll(/"en"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) add(JSON.parse(`"${match[1]}"`) as string)
    continue
  }
  for (const match of source.matchAll(pairs[0]!)) {
    const first = literal(match, 1)
    const second = literal(match, 4)
    if (CYRILLIC.test(first) && !CYRILLIC.test(second)) add(second)
    else if (CYRILLIC.test(second) && !CYRILLIC.test(first)) add(first)
  }
  for (const match of source.matchAll(pairs[1]!)) add(literal(match, 1))
  // `locale === 'en' ? 'English' :` with anything else after the colon
  for (const match of source.matchAll(new RegExp(String.raw`(?:===?\s*'en'|en)\s*\?\s*${LITERAL}`, 'g'))) add(literal(match, 1))
}

const out = process.argv[2] ?? join(root, 'scripts', 'i18n', 'english-texts.json')
const list = [...texts].sort((a, b) => a.localeCompare(b))
writeFileSync(out, `${JSON.stringify(list, null, 1)}\n`)
console.log(`${list.length} texts, ${list.reduce((sum, text) => sum + text.length, 0)} characters → ${relative(root, out)}`)
