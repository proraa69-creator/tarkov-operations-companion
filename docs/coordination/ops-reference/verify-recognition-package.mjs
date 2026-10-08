import { createRequire } from 'node:module'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
const root = '/opt/raidos-repair-20261008'
const suffix = process.env.REPAIR_RELEASE_SUFFIX || 'recognition-repair'
const require = createRequire(`${root}/package.json`)
const asar = require('@electron/asar')
for (const edition of ['client', 'owner']) {
  const resources = join(root, `release-${edition}-${suffix}`, 'win-unpacked', 'resources')
  const archive = join(resources, 'app.asar')
  const names = new Set(asar.listPackage(archive))
  for (const name of ['/dist-electron/electron/questScreenshot.js', '/dist-electron/src/overlay/tooltipLookup.js', '/node_modules/tesseract.js/package.json', '/node_modules/tesseract.js-core/package.json', '/node_modules/node-fetch/package.json', '/node_modules/bmp-js/package.json']) {
    if (!names.has(name)) throw new Error(`Missing packaged dependency: ${edition} ${name}`)
  }
  if (!asar.extractFile(archive, 'dist-electron/src/overlay/tooltipLookup.js').toString().includes('grabWide')) throw new Error('Old lookup code packaged')
  if (!asar.extractFile(archive, 'dist-electron/electron/main.js').toString().includes('quests:read-screenshot')) throw new Error('Old IPC code packaged')
  if (suffix.startsWith('weapon-story')) {
    const main = asar.extractFile(archive, 'dist-electron/electron/main.js').toString()
    const timing = asar.extractFile(archive, 'dist-electron/src/import/storyScanTiming.js').toString()
    const rendererName = [...names].find(name => /^\/dist\/assets\/index-[^/]+\.js$/.test(name))
    if (!rendererName) throw new Error('Missing renderer')
    const renderer = asar.extractFile(archive, rendererName.slice(1)).toString()
    if (!main.includes('backgroundThrottling: false') || !timing.includes('storyMs: 600') || !renderer.includes('is-weapon') || !renderer.includes('weaponPreset')) throw new Error('Weapon/story fixes are missing from package')
    const api = asar.extractFile(archive, 'dist-electron/local-server/server.cjs').toString()
    if (!api.includes('6a15ae2ae5267ba21c07f98f') || !api.includes('6a78b7f8c2016eb33e0027cd')) throw new Error('Cosmetic weapon fallback missing from packaged server')
  }
  if (suffix.startsWith('overlay-story')) {
    const main = asar.extractFile(archive, 'dist-electron/electron/experimental/index.js').toString()
    const preload = asar.extractFile(archive, 'electron/preload.cjs').toString()
    const placement = asar.extractFile(archive, 'dist-electron/src/overlay/itemCardPlacement.js').toString()
    const rendererName = [...names].find(name => /^\/dist\/assets\/index-[^/]+\.js$/.test(name))
    if (!rendererName) throw new Error('Missing renderer')
    const scan = asar.extractFile(archive, rendererName.slice(1)).toString()
    const retention = asar.extractFile(archive, 'dist-electron/electron/experimental/mapScreenshotRetention.js').toString()
    const updater = asar.extractFile(archive, 'dist-electron/electron/appUpdate.js').toString()
    if (!main.includes('itemCardAnchor') || !main.includes('overlay:visibility') || !preload.includes('overlay:visibility')
      || !placement.includes('point.x + 16') || !scan.includes('storyObjectives') || !retention.includes('isSymbolicLink')) throw new Error('Overlay/story fixes are missing from package')
    if (!updater.includes('startupConsumed') || !updater.includes('blockedByRaid') || !updater.includes('pipeline(') || updater.includes("app.on('will-quit'")) throw new Error('Startup-only update safety missing from package')
  }
  const info = JSON.parse(asar.extractFile(archive, 'dist-electron/build-info.json').toString())
  if (info.edition !== edition || !info.commit.endsWith(`-${suffix}`)) throw new Error('Wrong build info')
  for (const lang of ['rus', 'eng']) if ((await stat(join(resources, 'tessdata', `${lang}.traineddata`))).size < 1_000_000) throw new Error('OCR models missing')
  if ((await readFile(join(resources, 'koffi', 'win32_x64', 'koffi.node'))).subarray(0, 2).toString() !== 'MZ') throw new Error('Wrong native module platform')
  console.log(`${edition}: new capture code, all OCR dependencies/models, Windows native module verified`)
}
