// Partial update of the app (electron/appDelta.ts): puts the players' app.asar of this build, unchanged, next to the
// site, so a copy downloads only the files that changed (HTTP Range):
//   website/dist/app-delta/app.asar, app.asar.unpacked/…, info.json
// Called from the afterPack hook (scripts/pack-windows-native.cjs) for the client edition, and only when the website of
// this checkout is already built (the VPS release builds the site first, then both Windows editions). The players' exe
// is public anyway; the owner build's files (e-mails, edition) never go here. info.json carries the archive's size and
// SHA-256 (whole and header); the release's root process checks them again and signs it with the update key
// (signAppDelta, scripts/sign-client-release.mjs) — players take only a signed one.
const { createHash } = require('node:crypto')
const { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

/** SHA-256 of a file, or of its first `limit` bytes, read in 1 MiB pieces (the archive is ~150 MB). */
function sha256File(path, limit = Infinity) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    for (let position = 0; position < limit;) {
      const read = readSync(fd, buffer, 0, Math.min(buffer.length, limit - position), position)
      if (!read) break
      hash.update(buffer.subarray(0, read))
      position += read
    }
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/** SHA-256 of every file in resources outside the archive ('/'-separated), as electron/deltaUpdate.ts computes it. */
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
  const published = join(out, 'app.asar')
  const dataStart = 8 + headerSize
  const manifest = {
    format: 1,
    build: info.build,
    version: info.version,
    commit: info.commit,
    electron,
    asar: { size: statSync(published).size, dataStart, sha256: sha256File(published), headerSha256: sha256File(published, dataStart) },
    resources: resourceHashes(resources),
  }
  writeFileSync(join(out, 'info.json'), `${JSON.stringify(manifest)}\n`)
  console.log(`Partial update: build ${info.build}, ${(manifest.asar.size / 1048576).toFixed(1)} MB archive → website/dist/app-delta`)
  return manifest
}

module.exports = { publishAppDelta, resourceHashes }
