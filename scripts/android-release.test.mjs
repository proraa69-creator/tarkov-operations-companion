import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { androidVersion, writeAndroidRelease } from './android-release.mjs'
import { parseAndroidRelease } from '../src/mobile/androidUpdate'

/** The site files for the Android in-app update: version numbers like android/app/build.gradle, a version.json the app accepts. */
let dir = ''
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })

describe('scripts/android-release.mjs', () => {
  it('numbers versions like the Gradle build, always growing', () => {
    expect(androidVersion('0.6.0-29')).toEqual({ name: '0.6.0.29', code: 600029 })
    expect(androidVersion('0.6.0')).toEqual({ name: '0.6.0', code: 600000 })
    expect(androidVersion('0.7.0')).toEqual({ name: '0.7.0', code: 700000 })
    expect(androidVersion('1.0.0-1')).toEqual({ name: '1.0.0.1', code: 10000001 })
    const order = ['0.6.0-29', '0.6.0-30', '0.6.0-999', '0.6.1', '0.6.1-1', '0.7.0', '1.0.0'].map((value) => androidVersion(value).code)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(() => androidVersion('0.6.0-1000')).toThrow(/does not fit/)
    expect(() => androidVersion('0.6')).toThrow(/three or four/)
    expect(() => androidVersion('0.6.0-beta')).toThrow(/numbers only/)
  })

  it('writes the APK and a version.json that the app accepts', async () => {
    dir = await mkdtemp(join(tmpdir(), 'raidos-android-'))
    const apk = join(dir, 'app-release.apk')
    await writeFile(apk, Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(1000, 7)]))
    const release = await writeAndroidRelease(apk, join(dir, 'out'), '0.6.0-30')
    expect(release).toMatchObject({ versionCode: 600030, versionName: '0.6.0.30', url: 'https://raidos.app/download/android/raid-os-0.6.0.30.apk', size: 1004 })
    const written = await readFile(join(dir, 'out', 'version.json'), 'utf8')
    expect(parseAndroidRelease(written)).toEqual(release)
    expect((await readFile(join(dir, 'out', 'raid-os-0.6.0.30.apk'))).length).toBe(1004)

    await writeFile(apk, 'not a zip')
    await expect(writeAndroidRelease(apk, join(dir, 'out'), '0.6.0-31')).rejects.toThrow(/not an APK/)
  })
})
