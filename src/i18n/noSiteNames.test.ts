import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Owner, 06.11.2026: «Удали все надписи, упоминания Tarkov Dev, Tarkov Help. У нас наши сборки, наши скриншоты.» No screen,
 * dictionary, news line or version row names these sites. Addresses the app reads from and ids in the code are no text.
 */
const NAME = /tarkov[ ._-]*(dev|help)\b|tarkovdev|tarkovhelp|тарков[ ._-]*(дев|хелп)/i
const NOT_TEXT = [/(assets|json|api|players|player|minio)\.tarkov\.(dev|help)/gi, /'tarkov-dev'/g, /tarkov-dev-map[\w-]*/g, /\bsource === 'tarkov\.help'/g]
const SKIP = /\.(test|spec|e2e)\.(ts|tsx)$|__fixtures__|fixtures/

const withoutComments = (text: string) => text
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(?<![:'"`])\/\/.*$/gm, '')

function files(dir: string, wanted: RegExp): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path, wanted)
    return wanted.test(name) && !SKIP.test(path.replace(/\\/g, '/')) ? [path] : []
  })
}

const named = (path: string) => {
  const text = NOT_TEXT.reduce((rest, pattern) => rest.replace(pattern, ''), withoutComments(readFileSync(path, 'utf8')))
  return NAME.test(text)
}

describe('the sites the data comes from are named nowhere a person reads', () => {
  it('not in a screen of the app or the site', () => {
    expect([...files('src', /\.tsx$/), ...files('website/src', /\.tsx?$/)].filter(named)).toEqual([])
  })

  it('not in the English dictionary', () => {
    expect(files('src/i18n', /\.ts$/).filter(named)).toEqual([])
  })

  it('not in the news or the list of versions', () => {
    expect(['src/data/playerNews.json', 'src/data/updateHistory.json'].filter(named)).toEqual([])
  })
})
