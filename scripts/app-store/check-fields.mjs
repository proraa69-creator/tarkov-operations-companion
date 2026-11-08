// Checks the App Store Connect fields of docs/app-store/README.md against Apple's limits: every ```text block is
// measured by the section it stands in. `node scripts/app-store/check-fields.mjs` → a table, exit 1 if a field is too long.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const text = readFileSync(join(here, '..', '..', 'docs', 'app-store', 'README.md'), 'utf8')
const LIMITS = [
  [/^### Subtitle/, 'Subtitle', 30],
  [/^### Promotional Text/, 'Promotional Text', 170],
  [/^### Description/, 'Description', 4000],
  [/^### Keywords/, 'Keywords', 100],
  [/^### What's New/, "What's New", 4000],
  [/^## 6\. App Review Information/, 'Review Notes', 4000],
]
let section = null
let block = null
let failed = false
for (const line of text.split('\n')) {
  if (block) {
    if (line.startsWith('```')) {
      const value = block.join('\n')
      const length = [...value].length
      const ok = !section || length <= section[2]
      if (!ok) failed = true
      if (section && section[1] === 'Keywords' && /, /.test(value)) { failed = true; console.log('  keywords: a space after a comma') }
      console.log(`${ok ? 'ok ' : 'TOO LONG'} ${(section?.[1] ?? '?').padEnd(17)} ${String(length).padStart(4)} / ${section?.[2] ?? '-'}  ${value.split('\n')[0].slice(0, 50)}`)
      block = null
    } else block.push(line)
    continue
  }
  const match = LIMITS.find(([re]) => re.test(line))
  if (match) section = match
  else if (/^#{2,3} /.test(line)) section = null
  if (line.startsWith('```text')) block = []
}
process.exit(failed ? 1 : 0)
