// @vitest-environment node
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { displayVersion } from './appVersion'

const root = new URL('../../', import.meta.url)
const packageVersion = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version as string

describe('app version', () => {
  it('shows the owner\'s numbering', () => {
    expect(displayVersion('0.6.0-2')).toBe('0.6.0.2')
    expect(displayVersion('0.7.0')).toBe('0.7.0')
    expect(displayVersion('0.6.0-beta')).toBe('0.6.0-beta')
  })

  it('is a version electron-builder builds (it refused «0.6.0.1»: 0.5.4.2–0.6.0.1 were never published)', async () => {
    const { readPackageJson } = createRequire(import.meta.url)('app-builder-lib/out/util/packageMetadata.js') as { readPackageJson: (file: string) => Promise<{ version: string }> }
    await expect(readPackageJson(new URL('package.json', root).pathname)).resolves.toMatchObject({ version: packageVersion })
    // loading app-builder-lib takes ~0.5 s alone and ~10 s under the full suite's load
  }, 60_000)

  it('the website shows the same version as the app', () => {
    const config = readFileSync(new URL('website/src/config.ts', root), 'utf8')
    expect(config).toContain(`APP_VERSION = '${displayVersion(packageVersion)}'`)
  })
})
