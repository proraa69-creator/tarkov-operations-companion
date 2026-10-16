// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILD_SCREENSHOTS, buildScreenshot, screenshotFiles } from './buildScreenshots'

const folder = join(__dirname, '..', 'assets', 'gunsmith-builds')
const M4A1 = '5447a9cd4bdc2dbd208b4567'

describe('the owner\'s Gunsmith build screenshots (src/gunsmith/buildScreenshots.ts)', () => {
  it('every listed build has its file and every file is listed, once', () => {
    const listed = BUILD_SCREENSHOTS.map(([, , file]) => file)
    expect(new Set(listed).size).toBe(listed.length)
    expect([...screenshotFiles.keys()].sort()).toEqual([...listed].sort())
    expect(readdirSync(folder).sort()).toEqual(listed.map((file) => `${file}.webp`).sort())
    const builds = BUILD_SCREENSHOTS.map(([task, weapon]) => `${task}:${weapon}`)
    expect(new Set(builds).size).toBe(builds.length)
    for (const [task, weapon] of BUILD_SCREENSHOTS) {
      expect(task).toMatch(/^[0-9a-f]{24}$/)
      expect(weapon).toMatch(/^[0-9a-f]{24}$/)
    }
  })

  it('the files are WebP pictures small enough to ship with the app', () => {
    for (const name of readdirSync(folder)) {
      const bytes = readFileSync(join(folder, name))
      expect(bytes.subarray(0, 4).toString('ascii'), name).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString('ascii'), name).toBe('WEBP')
      expect(bytes.length, name).toBeLessThan(300 * 1024)
    }
  })

  it('finds the screenshot by the task and its weapon: the M4A1 of «Оружейник. М4A1» is not the one of «Мастер. Часть 9»', () => {
    const part = buildScreenshot('5ac244eb86f7741356335af1', M4A1)
    const master = buildScreenshot('5b47825886f77468074618d3', M4A1)
    expect(part).toBe(screenshotFiles.get('gunsmith-m4a1'))
    expect(master).toBe(screenshotFiles.get('gunsmith-master-part-9'))
    expect(part).not.toBe(master)
    // «Мастер. Часть 12» asks for three weapons: only the T-5000M has its screenshot so far.
    expect(buildScreenshot('676529af9c90953d090882e7', '5df24cf80dee1b22f862e9bc')).toBe(screenshotFiles.get('gunsmith-master-part-12-t-5000m'))
    expect(buildScreenshot('676529af9c90953d090882e7', '5a7ae0c351dfba0017554310')).toBeUndefined()
    expect(buildScreenshot('5ac244eb86f7741356335af1', '5bb2475ed4351e00853264e3')).toBeUndefined()
    expect(buildScreenshot(undefined, M4A1)).toBeUndefined()
  })
})
