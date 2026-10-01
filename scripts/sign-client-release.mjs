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
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { createReadStream, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
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

/** The signed manifest of the client exe; checked against `publicKey` before it is returned. */
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
  return { ...manifest, signature }
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
