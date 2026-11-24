/**
 * The exits' names as the game writes them in each language (owner, 24.11.2026: «проверь, как это пишется на китайском в
 * игре»): the app shows its own short English names under the exits' icons (src/data/exitShortNames.ts); a language whose
 * game translates the exits (Chinese, Korean, Turkish…) gets the game's own name for both the short and the full English
 * name in its phrase file. Languages whose game keeps the English names (German, Japanese) get nothing.
 *
 *   node scripts/i18n/exit-names.mjs [lang …]      (default: every language with tarkov.dev dictionaries)
 *
 * Run it after merging translated chunks (scripts/i18n/merge-chunks.py): its names win over a translator's.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const LANGUAGES = process.argv.slice(2).length ? process.argv.slice(2) : ['de', 'ja', 'zh', 'pl', 'es', 'pt', 'fr', 'ko', 'tr']
const NON_LATIN = new Set(['ja', 'zh', 'ko'])

const source = readFileSync(join(root, 'src/data/exitShortNames.ts'), 'utf8')
const rows = [...source.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*'((?:[^'\\]|\\.)*)'\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\]/g)]
  .map((match) => ({ full: match[2].slice(1, -1).replace(/\\(.)/g, '$1'), short: match[4].slice(1, -1).replace(/\\(.)/g, '$1') }))

const json = async (url) => {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return (await response.json()).data
}

const english = await json('https://json.tarkov.dev/regular/maps_en')
const keysByName = new Map()
for (const [key, name] of Object.entries(english)) if (typeof name === 'string') keysByName.set(name.trim(), [...(keysByName.get(name.trim()) ?? []), key])

for (const language of LANGUAGES) {
  const target = await json(`https://json.tarkov.dev/regular/maps_${language}`)
  const path = join(root, 'src/i18n/locales', `${language}.json`)
  const table = JSON.parse(readFileSync(path, 'utf8'))
  let added = 0
  for (const { full, short } of rows) {
    // Several exits may share an English name (PMC and Scav sides): the name most of them have in the language.
    const counts = new Map()
    for (const key of keysByName.get(full) ?? []) {
      const name = typeof target[key] === 'string' ? target[key].trim() : ''
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    const official = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
    if (!official || official === full) continue
    // A game in another script that keeps the English names (Japanese): its English variants are not names to show.
    if (NON_LATIN.has(language) && !/[^\x00-\x7F]/.test(official)) continue
    for (const english of new Set([full, short])) {
      if (table[english] !== official) { table[english] = official; added += 1 }
    }
  }
  // The same layout as scripts/i18n/merge-chunks.py: one phrase per line, sorted by the English (code point order).
  const sorted = Object.entries(table).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  writeFileSync(path, `{\n${sorted.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n}\n`)
  console.log(`${language}: ${added} exit names from the game`)
}
