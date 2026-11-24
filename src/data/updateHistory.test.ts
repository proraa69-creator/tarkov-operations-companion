// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { version as packageVersion } from '../../package.json'
import { displayVersion } from '../app/appVersion'
import type { UpdateHistoryRow } from '../shared/updateHistory'
import history from './updateHistory.json'

/**
 * «История обновлений» (owner, 05.11.2026: «соответственно дополняй всегда эту таблицу»): a release whose version has no
 * row here fails the Production Gate, so it is not published (docs/coordination/COORDINATION.md, Release checklist).
 */
const rows: UpdateHistoryRow[] = history
const versions = new Set(rows.map((row) => row.version))
const VERSION = /^\d+\.\d+\.\d+(\.\d+)?$/
const MAX_LINE = 110
const MAX_LINES = 4
/** 0.5.4 stood for twelve days (29.09–10.10.2026) before each version got its own number: the one longer row. */
const MAX_LINES_OF: Record<string, number> = { '0.5.4': 10 }
/** 0.6.0.282: the owner's own line, word for word, one letter over. */
const MAX_LINE_OF: Record<string, number> = { '0.6.0.282': 111 }

const numbers = (version: string) => version.split('.').map(Number)
/** Above zero when `a` is newer; 0.6.0 is older than 0.6.0.1. */
function compare(a: string, b: string) {
  const [x, y] = [numbers(a), numbers(b)]
  for (let index = 0; index < Math.max(x.length, y.length); index++) {
    const difference = (x[index] ?? -1) - (y[index] ?? -1)
    if (difference) return difference
  }
  return 0
}

describe('«История обновлений»: src/data/updateHistory.json', () => {
  it('has a row for the version in package.json', () => {
    const current = displayVersion(packageVersion)
    expect(versions.has(current), `A release adds its row in the release commit: put { "version": "${current}", "date": "YYYY-MM-DD", "changes": ["…"] } first in src/data/updateHistory.json`).toBe(true)
  })

  it('every row is well formed', () => {
    for (const row of rows) {
      expect(Object.keys(row).filter((key) => key !== 'reports').sort(), row.version).toEqual(['changes', 'date', 'version'])
      expect(row.version, row.version).toMatch(VERSION)
      expect(row.date, row.version).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10), `${row.version}: a real date`).toBe(row.date)
      expect(row.changes.length, `${row.version}: lines`).toBeGreaterThan(0)
      expect(row.changes.length, `${row.version}: only the main things`).toBeLessThanOrEqual(MAX_LINES_OF[row.version] ?? MAX_LINES)
      expect(new Set(row.changes).size, `${row.version}: a line twice`).toBe(row.changes.length)
      for (const line of row.changes) {
        expect(line, row.version).toBe(line.trim())
        expect(line.length, `${row.version}: an empty line`).toBeGreaterThan(0)
        expect(line.length, `${row.version}: too long for a short line: ${line}`).toBeLessThanOrEqual(MAX_LINE_OF[row.version] ?? MAX_LINE)
        expect(line, `${row.version}: Russian text`).toMatch(/[а-яё]/i)
      }
    }
  })

  it('a row\'s reports are numbers, each once: what cannot be read would close nothing, silently', () => {
    for (const row of rows) {
      if (!('reports' in row)) continue
      const { reports } = row
      expect(Array.isArray(reports) && reports.length > 0, `${row.version}: "reports":[85], or no field at all`).toBe(true)
      for (const report of reports!) expect(Number.isSafeInteger(report) && report > 0, `${row.version}: report ${String(report)}`).toBe(true)
      expect(new Set(reports).size, `${row.version}: a report twice`).toBe(reports!.length)
    }
  })

  it('newest first, no version twice, the dates never go forward', () => {
    expect(versions.size).toBe(rows.length)
    rows.slice(1).forEach((row, index) => {
      const newer = rows[index]!
      expect(compare(newer.version, row.version), `${newer.version} stands above ${row.version}`).toBeGreaterThan(0)
      expect(newer.date >= row.date, `${newer.version} (${newer.date}) is older than ${row.version} (${row.date})`).toBe(true)
    })
  })

  it('holds nothing that may not be seen: e-mails, addresses, paths, keys', () => {
    const FORBIDDEN: Array<[string, RegExp]> = [
      ['an e-mail', /[^\s@«»]+@[^\s@«»]+\.[^\s@«»]+/],
      ['an IP address', /\b[1-9]\d{0,2}(\.\d{1,3}){3}\b/],
      ['a server or disk path', /(^|[\s(«])(\/(opt|etc|var|usr|root|home|run)\b|[A-Za-z]:\\)/],
      ['a link', /https?:\/\//i],
      ['a file name', /\b[\w-]+\.(sqlite|pem|key|env|json|tsx?|mjs|cjs|sh|exe)\b/i],
      ['a key, a token or a password', /токен|token|парол|password|секрет|secret|api[- ]?key|ключ подписи/i],
      ['a hash', /\b[a-f0-9]{7,}\b/i],
      ['a card or an account number', /\b\d{12,19}\b/],
    ]
    for (const row of rows) {
      for (const line of row.changes) {
        // A four-part version of this list is not an IP address.
        const text = line.replace(/\b\d+\.\d+\.\d+\.\d+\b/g, (found) => (versions.has(found) ? '' : found))
        for (const [what, pattern] of FORBIDDEN) expect(text, `${row.version}: ${what}`).not.toMatch(pattern)
      }
    }
  })

  it('no client imports the list: it stays on the server, behind the owner-only route', () => {
    const IMPORT = /(?:from\s+|import\(\s*|import\s+|require\(\s*)['"][^'"]*updateHistory\.json['"]/
    const root = process.cwd()
    const self = join('src', 'data', 'updateHistory.test.ts')
    const walk = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name)
      if (entry.isDirectory()) return walk(path)
      return /\.(?:tsx?|jsx?|mjs|cjs)$/.test(entry.name) ? [path] : []
    })
    const importing = ['src', 'website/src', 'electron'].flatMap((folder) => walk(join(root, folder)))
      .filter((path) => relative(root, path) !== self && IMPORT.test(readFileSync(path, 'utf8')))
    expect(importing).toEqual([])
  })
})
