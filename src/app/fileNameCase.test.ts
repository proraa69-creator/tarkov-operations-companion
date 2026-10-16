// @vitest-environment node
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '../..')
const CODE = /\.(?:tsx?|jsx?|mjs|cjs)$/

/** Code modules of each folder by name without extension, the way an import without one finds them. */
function collisions(folder: string, found: string[][] = []) {
  const entries = readdirSync(folder, { withFileTypes: true })
  const byName = new Map<string, Set<string>>()
  for (const entry of entries) {
    if (entry.isDirectory()) { if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) collisions(join(folder, entry.name), found); continue }
    if (!CODE.test(entry.name) || /\.test\.|\.d\.ts$/.test(entry.name)) continue
    const name = entry.name.replace(CODE, '')
    const group = byName.get(name.toLowerCase()) ?? new Set<string>()
    group.add(name)
    byName.set(name.toLowerCase(), group)
  }
  for (const group of byName.values()) if (group.size > 1) found.push([...group].map((name) => relative(root, join(folder, name))))
  return found
}

describe('file names', () => {
  // Windows and macOS do not tell «FirstRunGuide.tsx» from «firstRunGuide.ts»: an import without an extension then
  // finds the wrong module (the iPhone build broke on it in 0.6.0.25; the Windows build runs on Linux).
  it('no two modules of a folder differ only in letter case', () => {
    expect(['src', 'electron', 'server/src', 'website/src'].flatMap((folder) => collisions(join(root, folder)))).toEqual([])
  })
})
