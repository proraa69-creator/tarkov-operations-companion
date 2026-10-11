#!/usr/bin/env node
// Signs the players' (client) exe for auto-update (electron/appUpdate.ts):
//   node scripts/sign-client-release.mjs "<client exe>" "<client build-info.json>" [--out <version.json>]
// Prints one line of JSON {version, build, commit, edition:'client', size, sha256, signature}: the server laptop's
// client\version.json (Server-Laptop-Setup.cmd from scripts/split-exe-for-chat.sh writes it, electron/localServer.ts serves
// it). `signature` is Ed25519 (base64) over the canonical text of electron/updateManifest.ts; a player's copy installs only
// a build whose manifest verifies with UPDATE_SIGNING_PUBLIC_KEY (electron/updateSigningKey.ts).
//
// Private key (PKCS#8 PEM, never in the repository): RAIDOS_UPDATE_SIGNING_KEY (the PEM text, or base64 of the PEM) or
// RAIDOS_UPDATE_SIGNING_KEY_FILE (path to the PEM file). The key is never printed. The script refuses to write anything
// when the key does not match the public key in electron/updateSigningKey.ts.
//
// The VPS release (docs/coordination/ops-reference/auto-release.mjs) runs an installed root-owned copy of this file:
// besides the exe it signs the release's partial update published next to the build (website/dist/app-delta/info.json,
// scripts/publish-app-delta.cjs; signAppDelta below) — players take a release in parts only when that signature verifies.
// Only Node built-ins here.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { closeSync, createReadStream, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const UPDATE_PAYLOAD_PREFIX = 'raidos-update-v1'

const isLine = (value) => typeof value === 'string' && value.length <= 200 && [...value].every((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Same text and checks as canonicalUpdatePayload in electron/updateManifest.ts (electron/updateManifest.test.ts compares them). */
export function canonicalUpdatePayload({ edition, version, build, commit, size, sha256 }) {
  if (edition !== 'client' && edition !== 'owner') throw new Error('update manifest: edition must be client or owner')
  if (!isLine(version) || !isLine(commit)) throw new Error('update manifest: version and commit must be one line of text')
  if (!isCount(build) || !isCount(size)) throw new Error('update manifest: build and size must be positive integers')
  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('update manifest: sha256 must be 64 lowercase hex digits')
  return `${UPDATE_PAYLOAD_PREFIX}\n${edition}\n${version}\n${build}\n${commit}\n${size}\n${sha256}`
}

/** The public key the app is built with (read from electron/updateSigningKey.ts). */
export function embeddedPublicKey(root = ROOT) {
  const source = readFileSync(join(root, 'electron', 'updateSigningKey.ts'), 'utf8')
  const pem = /-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/.exec(source)?.[0]
  if (!pem) throw new Error('electron/updateSigningKey.ts has no public key')
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('electron/updateSigningKey.ts: not an Ed25519 key')
  return key
}

/** The private key from RAIDOS_UPDATE_SIGNING_KEY / RAIDOS_UPDATE_SIGNING_KEY_FILE; errors never contain the key. */
export function readSigningKey(env = process.env) {
  let text = env.RAIDOS_UPDATE_SIGNING_KEY?.trim() ?? ''
  if (!text && env.RAIDOS_UPDATE_SIGNING_KEY_FILE?.trim()) text = readFileSync(env.RAIDOS_UPDATE_SIGNING_KEY_FILE.trim(), 'utf8').trim()
  if (!text) throw new Error('no signing key: set RAIDOS_UPDATE_SIGNING_KEY_FILE (path to the Ed25519 private key PEM) or RAIDOS_UPDATE_SIGNING_KEY')
  // base64 of the PEM (one line, handy for a CI secret); a PEM pasted into one line with literal \n works too
  if (!text.includes('-----BEGIN')) text = Buffer.from(text, 'base64').toString('utf8')
  text = text.replace(/\\n/g, '\n')
  if (!text.includes('-----BEGIN')) throw new Error('the signing key is neither a PEM private key nor base64 of one')
  let key
  try { key = createPrivateKey(text) } catch { throw new Error('the signing key could not be read (expected an unencrypted PKCS#8 PEM private key)') }
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('the signing key is not an Ed25519 key')
  return key
}

async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * The signed manifest of the client exe; checked against `publicKey` before it is returned. The partial update the build
 * published next to it, if any, is signed in place (signAppDeltaNextTo); that never stops the exe's own signature.
 */
export async function signClientRelease({ exe, buildInfo, privateKey, publicKey }) {
  const info = JSON.parse(readFileSync(buildInfo, 'utf8'))
  if (info.edition !== 'client') throw new Error(`not a client build-info.json (edition: ${info.edition})`)
  // Only characters cmd.exe echoes as they are (Server-Laptop-Setup.cmd writes the JSON with echo).
  const safe = (value) => String(value ?? '').replace(/[^0-9A-Za-z._-]/g, '')
  const manifest = { version: safe(info.version), build: Number(info.build) || 0, commit: safe(info.commit), edition: 'client', size: statSync(exe).size, sha256: await sha256File(exe) }
  const payload = Buffer.from(canonicalUpdatePayload(manifest), 'utf8')
  const signature = sign(null, payload, privateKey).toString('base64')
  if (!verify(null, payload, publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('the signing key does not match the public key in electron/updateSigningKey.ts: nothing was signed')
  }
  const signed = { ...manifest, signature }
  signAppDeltaNextTo({ exe, release: signed, privateKey, publicKey })
  return signed
}

export const DELTA_PAYLOAD_PREFIX = 'raidos-app-delta-v1'
const HEX64 = /^[a-f0-9]{64}$/
const SAFE_PATH = /^[A-Za-z0-9._@+ -]+(\/[A-Za-z0-9._@+ -]+)*$/

/** Same text and checks as canonicalDeltaPayload in electron/deltaInfo.ts (electron/deltaInfo.test.ts compares them). */
export function canonicalDeltaPayload({ build, version, commit, electron, asar, resources }) {
  if (!asar.sha256 || !HEX64.test(asar.sha256) || !asar.headerSha256 || !HEX64.test(asar.headerSha256)) throw new Error('app delta: archive hashes missing')
  for (const value of [version, commit, electron]) if (!/^[\x20-\x7e]{1,200}$/.test(value)) throw new Error('app delta: version, commit and electron must be one line of text')
  for (const value of [build, asar.size, asar.dataStart]) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('app delta: build and archive sizes must be positive integers')
  for (const [name, hash] of Object.entries(resources)) if (!SAFE_PATH.test(name) || !HEX64.test(hash)) throw new Error('app delta: bad resource entry')
  const files = Object.keys(resources).sort().map((name) => `${name}=${resources[name]}`).join('\n')
  return `${DELTA_PAYLOAD_PREFIX}\n${build}\n${version}\n${commit}\n${electron}\n${asar.size}\n${asar.dataStart}\n${asar.sha256}\n${asar.headerSha256}\n${files}`
}

/** SHA-256 of a file, or of its first `limit` bytes, read in 1 MiB pieces. */
function sha256Of(path, limit = Infinity) {
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

/** Where an asar archive's file data starts: 8 + the size of its header pickle (@electron/asar's layout). */
function asarDataStart(path) {
  const fd = openSync(path, 'r')
  try {
    const prefix = Buffer.alloc(8)
    if (readSync(fd, prefix, 0, 8, 0) !== 8 || prefix.readUInt32LE(0) !== 4) throw new Error('app delta: not an asar archive')
    const size = prefix.readUInt32LE(4)
    if (size < 8 || size > 32 * 1024 * 1024) throw new Error('app delta: asar header size out of range')
    return 8 + size
  } finally {
    closeSync(fd)
  }
}

/** SHA-256 of every regular file in resources outside the archive ('/'-separated), as the app computes it (electron/deltaUpdate.ts). */
function resourceHashes(resources) {
  const out = {}
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!prefix && (entry.name === 'app.asar' || entry.name === 'app.asar.unpacked')) continue
      const name = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(dir, entry.name), name)
      else if (entry.isFile()) out[name] = sha256Of(join(dir, entry.name))
      else throw new Error(`app delta: resources/${name} is neither a file nor a folder`)
    }
  }
  walk(resources, '')
  return out
}

const sameEntries = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort())

/**
 * The release's partial update signed with the update key, after checking it against the build itself: the published
 * app.asar (`deltaDir`) must be byte for byte the archive the client exe was packed from (`resourcesDir`, its
 * win-unpacked resources), its size, header and SHA-256 and the files outside it are computed here, and build, version
 * and commit must be those of the signed exe (`release`). The build's own info.json must say the same — it is checked,
 * never trusted. Throws on any difference.
 */
export function signAppDelta({ deltaDir, resourcesDir, electronPackage, release, privateKey, publicKey }) {
  const infoPath = join(deltaDir, 'info.json')
  const archive = join(deltaDir, 'app.asar')
  const built = join(resourcesDir, 'app.asar')
  for (const path of [infoPath, archive, built]) if (!lstatSync(path).isFile()) throw new Error(`app delta: ${path} is not a regular file`)
  const published = JSON.parse(readFileSync(infoPath, 'utf8'))
  const size = statSync(archive).size
  const sha256 = sha256Of(archive)
  if (size !== statSync(built).size || sha256 !== sha256Of(built)) throw new Error('app delta: the published archive is not the one the client exe was built from')
  if (published.build !== release.build || published.version !== release.version || published.commit !== release.commit) throw new Error('app delta: build, version or commit differs from the signed exe')
  const dataStart = asarDataStart(archive)
  const manifest = {
    format: 1, build: release.build, version: release.version, commit: release.commit,
    electron: String(JSON.parse(readFileSync(electronPackage, 'utf8')).version ?? ''),
    asar: { size, dataStart, sha256, headerSha256: sha256Of(archive, dataStart) },
    resources: resourceHashes(resourcesDir),
  }
  const asar = published.asar ?? {}
  if (published.format !== 1 || published.electron !== manifest.electron || asar.size !== size || asar.dataStart !== dataStart || asar.sha256 !== sha256
    || asar.headerSha256 !== manifest.asar.headerSha256 || !sameEntries(published.resources, manifest.resources)) throw new Error('app delta: info.json differs from the build')
  const payload = Buffer.from(canonicalDeltaPayload(manifest), 'utf8')
  const signature = sign(null, payload, privateKey).toString('base64')
  if (!verify(null, payload, publicKey, Buffer.from(signature, 'base64'))) throw new Error('the signing key does not match the public key in electron/updateSigningKey.ts')
  return { ...manifest, signature }
}

/**
 * The partial update the VPS release builds next to the exe (<build>/website/dist/app-delta, the exe in
 * <build>/release-client/), signed in place. Anything wrong leaves it unsigned — players then take the whole exe.
 */
export function signAppDeltaNextTo({ exe, release, privateKey, publicKey }) {
  const exeDir = dirname(resolve(exe))
  const build = dirname(exeDir)
  const deltaDir = join(build, 'website', 'dist', 'app-delta')
  const infoPath = join(deltaDir, 'info.json')
  if (!existsSync(infoPath)) return null
  try {
    const signed = signAppDelta({ deltaDir, resourcesDir: join(exeDir, 'win-unpacked', 'resources'), electronPackage: join(build, 'node_modules', 'electron', 'package.json'), release, privateKey, publicKey })
    writeFileSync(infoPath, `${JSON.stringify(signed)}\n`)
    console.warn(`sign-client-release: partial update of build ${signed.build} signed`)
    return signed
  } catch (error) {
    console.warn(`sign-client-release: partial update left unsigned, players take the whole exe (${error instanceof Error ? error.message : String(error)})`)
    try {
      const raw = JSON.parse(readFileSync(infoPath, 'utf8'))
      if ('signature' in raw) { delete raw.signature; writeFileSync(infoPath, `${JSON.stringify(raw)}\n`) }
    } catch { /* nothing readable to strip */ }
    return null
  }
}

async function main(args) {
  const outAt = args.indexOf('--out')
  const out = outAt >= 0 ? args[outAt + 1] : ''
  const [exe, buildInfo] = args.filter((_, index) => outAt < 0 || (index !== outAt && index !== outAt + 1))
  if (!exe || !buildInfo || (outAt >= 0 && !out)) throw new Error('usage: node scripts/sign-client-release.mjs "<client exe>" "<client build-info.json>" [--out <version.json>]')
  const manifest = await signClientRelease({ exe, buildInfo, privateKey: readSigningKey(), publicKey: embeddedPublicKey() })
  const json = JSON.stringify(manifest)
  if (out) writeFileSync(out, `${json}\n`)
  process.stdout.write(`${json}\n`)
}

/** Run as a command, not when a test imports the helpers. */
function invokedDirectly() {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url))
    const invoked = realpathSync(resolve(process.argv[1] ?? ''))
    return process.platform === 'win32' ? self.toLowerCase() === invoked.toLowerCase() : self === invoked
  } catch {
    return false
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`sign-client-release: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
