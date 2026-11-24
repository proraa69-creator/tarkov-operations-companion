// Partial update of the app (electron/appDelta.ts): puts the players' app.asar of this build, unchanged, next to the
// site, so a copy downloads only the files that changed (HTTP Range):
//   website/dist/app-delta/app.asar, app.asar.unpacked/…, info.json
// Called from the afterPack hook (scripts/pack-windows-native.cjs) for the client edition, and only when the website of
// this checkout is already built (the VPS release builds the site first, then both Windows editions). The players' exe
// is public anyway; the owner build's files (e-mails, edition) never go here. info.json carries the archive's size and
// SHA-256 (whole and header); the release's root process checks them again and signs it with the update key
// (signAppDelta, scripts/sign-client-release.mjs) — players take only a signed one.
// brotli/ (owner, 03.11.2026: «обновление загружается очень медленно»): brotli copies of the archive's header and of the
// app's own text files a release usually changes, <sha256 of the original>.br, listed in brotli/index.json — the app
// takes a copy instead of the plain bytes when it unpacks to exactly those (electron/appDelta.ts parseBrotliIndex). Not
// in info.json: the root process writes that one anew from its own fields.
const { createHash } = require('node:crypto')
const { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { brotliCompressSync, constants } = require('node:zlib')

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
      // elevate.exe: electron-builder's helper, put in resources and signed anew by every build after the partial update is published — never part of what a partial update must match (owner, 28.10.2026: «до сих пор приложение скачивается полностью»).
      if (!prefix && (entry.name === 'app.asar' || entry.name === 'app.asar.unpacked' || entry.name === 'elevate.exe')) continue
      const path = join(dir, entry.name)
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path, name)
      else if (entry.isFile()) out[name] = sha256File(path)
    }
  }
  walk(resources, '')
  return out
}

/** `size` bytes of the file at `position`. */
function readAt(fd, position, size) {
  const buffer = Buffer.alloc(size)
  for (let done = 0; done < size;) {
    const read = readSync(fd, buffer, done, size - done, position + done)
    if (!read) throw new Error('app delta: archive cut short')
    done += read
  }
  return buffer
}

// What gets a brotli copy: the app's build (not node_modules, which seldom change) and every unpacked file, text only,
// from 4 KB; kept when it is at least a tenth smaller. Quality 9 (~1/3 of a JS bundle) packs the ~60 MB in seconds.
const BROTLI_PATH = /^dist(-electron)?\//
const BROTLI_TEXT = /\.(js|cjs|mjs|json|css|html|svg|txt|map|wasm)$/i
const BROTLI_MIN = 4096

function publishBrotli(out, dataStart, header, build) {
  const dir = join(out, 'brotli')
  mkdirSync(dir, { recursive: true })
  const files = {}
  const add = (data, hash) => {
    if (files[hash]) return
    const packed = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    if (packed.length > data.length * 0.9) return
    writeFileSync(join(dir, `${hash}.br`), packed)
    files[hash] = packed.length
  }
  const fd = openSync(join(out, 'app.asar'), 'r')
  try {
    const head = readAt(fd, 0, dataStart)
    add(head, createHash('sha256').update(head).digest('hex'))
    const walk = (tree, prefix) => {
      for (const [name, node] of Object.entries(tree.files)) {
        const path = prefix ? `${prefix}/${name}` : name
        if (node.files) { walk(node, path); continue }
        if (node.link || !node.integrity || node.size < BROTLI_MIN || !BROTLI_TEXT.test(name) || !(node.unpacked || BROTLI_PATH.test(path))) continue
        const data = node.unpacked ? readFileSync(join(out, 'app.asar.unpacked', ...path.split('/'))) : readAt(fd, dataStart + Number(node.offset), node.size)
        const hash = createHash('sha256').update(data).digest('hex')
        // Only a copy of exactly the bytes the header names.
        if (hash === node.integrity.hash && data.length === node.size) add(data, hash)
      }
    }
    walk(header, '')
  } finally {
    closeSync(fd)
  }
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ format: 1, build, files })}\n`)
  return files
}

function publishAppDelta({ root, appOutDir }) {
  const site = join(root, 'website', 'dist')
  if (!existsSync(join(site, 'index.html'))) return null
  const resources = join(appOutDir, 'resources')
  const archive = join(resources, 'app.asar')
  const asar = require(join(root, 'node_modules', '@electron', 'asar'))
  const info = JSON.parse(asar.extractFile(archive, 'dist-electron/build-info.json').toString('utf8'))
  if (info.edition !== 'client') return null
  const { header, headerSize } = asar.getRawHeader(archive)
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
  let copies = ''
  try {
    const files = Object.values(publishBrotli(out, dataStart, header, info.build))
    copies = `, ${files.length} brotli copies (${(files.reduce((sum, size) => sum + size, 0) / 1048576).toFixed(1)} MB)`
  } catch (error) {
    // Without the copies the app takes the same files plain: never a reason to stop the release.
    rmSync(join(out, 'brotli'), { recursive: true, force: true })
    console.warn(`Partial update: no brotli copies (${error instanceof Error ? error.message : String(error)})`)
  }
  console.log(`Partial update: build ${info.build}, ${(manifest.asar.size / 1048576).toFixed(1)} MB archive${copies} → website/dist/app-delta`)
  return manifest
}

module.exports = { publishAppDelta, resourceHashes }
