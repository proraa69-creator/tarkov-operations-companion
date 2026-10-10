// Partial update of the owner's app (electron/appDelta.ts): puts the players' app.asar of this build, unchanged, next to
// the site, so the owner's copy downloads only the files that changed (HTTP Range):
//   website/dist/app-delta/app.asar, app.asar.unpacked/…, info.json
// Called from the afterPack hook (scripts/pack-windows-native.cjs) for the client edition, and only when the website of
// this checkout is already built (the VPS release builds the site first, then both Windows editions). The players' exe
// is public anyway; the owner build's files (e-mails, edition) never go here.
const { createHash } = require('node:crypto')
const { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

/** SHA-256 of every file in resources outside the archive ('/'-separated), as electron/ownerDelta.ts computes it. */
function resourceHashes(resources) {
  const out = {}
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && (entry.name === 'app.asar' || entry.name === 'app.asar.unpacked')) continue
      const path = join(dir, entry.name)
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path, name)
      else if (entry.isFile()) out[name] = sha256File(path)
    }
  }
  walk(resources, '')
  return out
}

function publishAppDelta({ root, appOutDir }) {
  const site = join(root, 'website', 'dist')
  if (!existsSync(join(site, 'index.html'))) return null
  const resources = join(appOutDir, 'resources')
  const archive = join(resources, 'app.asar')
  const asar = require(join(root, 'node_modules', '@electron', 'asar'))
  const info = JSON.parse(asar.extractFile(archive, 'dist-electron/build-info.json').toString('utf8'))
  if (info.edition !== 'client') return null
  const { headerSize } = asar.getRawHeader(archive)
  const electron = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
  const out = join(site, 'app-delta')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(archive, join(out, 'app.asar'))
  if (existsSync(`${archive}.unpacked`)) cpSync(`${archive}.unpacked`, join(out, 'app.asar.unpacked'), { recursive: true })
  const manifest = {
    format: 1,
    build: info.build,
    version: info.version,
    commit: info.commit,
    electron,
    asar: { size: statSync(archive).size, dataStart: 8 + headerSize },
    resources: resourceHashes(resources),
  }
  writeFileSync(join(out, 'info.json'), `${JSON.stringify(manifest)}\n`)
  console.log(`Partial update for the owner's app: build ${info.build}, ${(manifest.asar.size / 1048576).toFixed(1)} MB archive → website/dist/app-delta`)
  return manifest
}

module.exports = { publishAppDelta, resourceHashes }
