// @vitest-environment node
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LEFTOVER_AGE_MS, removeLeftoverRunFolders, vitestTempCleanup } from './vitestTempDir'

const MODULE = '0123456789abcdef0123456789abcdef01234567'
let base = ''

const changedAgo = async (path: string, age: number) => {
  const time = new Date(Date.now() - age)
  await utimes(path, time, time)
}

/** A folder as a Vitest run leaves it: `client` and `ssr` with a module file each, all last changed `age` ago. */
async function runFolder(name: string, age: number, environments = ['client', 'ssr']) {
  const folder = join(base, name)
  for (const environment of environments) {
    await mkdir(join(folder, environment), { recursive: true })
    await writeFile(join(folder, environment, MODULE), 'export {}')
    await changedAgo(join(folder, environment), age)
  }
  await changedAgo(folder, age)
  return folder
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'raidos-vitest-temp-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

describe('Vitest run folders in Temp (disk C: full on 27.11.2026)', () => {
  it('removes the run folders a day old and keeps the newer ones', async () => {
    const old = await runFolder('V1StGXR8_Z5jdHi6B-myT', LEFTOVER_AGE_MS + 60_000)
    const oldClientOnly = await runFolder('aB3dE5gH7jK9mN1pQ3sT5', 3 * LEFTOVER_AGE_MS, ['client'])
    const fresh = await runFolder('Uakgb_J5m9g-0JDMbcJqL', 60 * 60_000)

    expect(await removeLeftoverRunFolders(base)).toBe(2)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(oldClientOnly)).toBe(false)
    expect(existsSync(fresh)).toBe(true)
  })

  it('never touches a folder that is not one of Vitest’s, however old', async () => {
    const day = LEFTOVER_AGE_MS + 60_000
    const otherName = await runFolder('raidos-quests-folder', day)
    const otherFolder = await runFolder('raidos-catalog-1GZvje', day, ['client', 'device-id'])
    const nested = await runFolder('-HA1pInR1deMJ9iwikzKF', day)
    await mkdir(join(nested, 'ssr', 'more'))
    await changedAgo(join(nested, 'ssr'), day)
    const empty = join(base, '-N_6Me_8I3XyBhzSr6WhP')
    await mkdir(empty)
    await changedAgo(empty, day)
    const target = await runFolder('junction-target', day)
    const link = join(base, '-VonB1NssUiWckoQ_ouUY')
    await symlink(target, link, 'junction')

    expect(await removeLeftoverRunFolders(base)).toBe(0)
    for (const folder of [otherName, otherFolder, nested, empty, link, join(target, 'ssr', MODULE)]) {
      expect(existsSync(folder)).toBe(true)
    }
  })

  it('takes away the run’s own folder when Vitest closes', async () => {
    const own = await runFolder('C0iZe6nhdofq5NZWXoGE_', 0)
    const closers: (() => Promise<void>)[] = []
    // Vitest spells it with forward slashes on Windows too (pathe)
    const vitest = { _tmpDir: own.replace(/\\/g, '/'), onClose: (closer: () => Promise<void>) => closers.push(closer) }
    const configureVitest = vitestTempCleanup(base).configureVitest as unknown as (context: { vitest: object }) => void

    configureVitest({ vitest })
    expect(existsSync(own)).toBe(true)
    await Promise.all(closers.map((closer) => closer()))
    expect(existsSync(own)).toBe(false)
  })
})
