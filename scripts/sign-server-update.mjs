#!/usr/bin/env node
// Signs one release of the server laptop for «Автообновление сервера» (electron/selfUpdate.ts):
//   node scripts/sign-server-update.mjs <parts dir> "<owner build-info.json>" ["<players' version.json>"]
// Reads RaidOS.part0..N (owner exe) and RaidOSClient.part0..N (players' exe, optional) in <parts dir> — the chat parts
// scripts/split-exe-for-chat.sh made — and writes <parts dir>/RaidOS-update.json:
//   {version, build, commit, owner:{size, sha256, parts:[{name,size,sha256}]}, client:{size, sha256, parts, versionJson}|null, signature}
// `signature` is Ed25519 (base64) over the canonical text of electron/serverUpdateManifest.ts (prefix
// «raidos-server-update-v1», so it can never pass for the players' manifest or the other way round). The players'
// version.json is the signed one from scripts/sign-client-release.mjs and must describe exactly the joined client exe.
//
// Same private key as the players' manifest: RAIDOS_UPDATE_SIGNING_KEY (PEM or base64 of it) or
// RAIDOS_UPDATE_SIGNING_KEY_FILE. Nothing is written when the key does not match electron/updateSigningKey.ts.
import { createHash, sign, verify } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalUpdatePayload, embeddedPublicKey, readSigningKey } from './sign-client-release.mjs'

export const SERVER_UPDATE_PAYLOAD_PREFIX = 'raidos-server-update-v1'
export const SERVER_UPDATE_FILE = 'RaidOS-update.json'
const MAX_UPDATE_EXE_BYTES = 400 * 1024 * 1024
const MAX_UPDATE_PARTS = 64
const VERSION = /^[0-9A-Za-z._+-]{1,64}$/
const COMMIT = /^[0-9A-Za-z._-]{0,64}$/
const SHA256 = /^[a-f0-9]{64}$/
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/
const isCount = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const partName = (edition, index) => `${edition === 'owner' ? 'RaidOS' : 'RaidOSClient'}.part${index}`

function exeLines(label, exe) {
  if (!isCount(exe.size) || exe.size > MAX_UPDATE_EXE_BYTES) throw new Error(`server update: ${label} size must be a positive integer up to ${MAX_UPDATE_EXE_BYTES}`)
  if (typeof exe.sha256 !== 'string' || !SHA256.test(exe.sha256)) throw new Error(`server update: ${label} sha256 must be 64 lowercase hex digits`)
  if (!Array.isArray(exe.parts) || exe.parts.length < 1 || exe.parts.length > MAX_UPDATE_PARTS) throw new Error(`server update: ${label} needs 1–${MAX_UPDATE_PARTS} parts`)
  let total = 0
  const lines = [`${label}=${exe.size} ${exe.sha256} ${exe.parts.length}`]
  exe.parts.forEach((part, index) => {
    if (!part || part.name !== partName(label, index)) throw new Error(`server update: ${label} part ${index} must be named ${partName(label, index)}`)
    if (!isCount(part.size)) throw new Error(`server update: ${part.name} size must be a positive integer`)
    if (typeof part.sha256 !== 'string' || !SHA256.test(part.sha256)) throw new Error(`server update: ${part.name} sha256 must be 64 lowercase hex digits`)
    total += part.size
    lines.push(`part=${part.name} ${part.size} ${part.sha256}`)
  })
  if (total !== exe.size) throw new Error(`server update: the ${label} parts add up to ${total} bytes, not ${exe.size}`)
  return lines
}

/** Same text and checks as canonicalServerUpdatePayload in electron/serverUpdateManifest.ts (a test compares them). */
export function canonicalServerUpdatePayload({ version, build, commit, owner, client }) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new Error('server update: version must be 1–64 of 0-9 A-Z a-z . _ + -')
  if (!isCount(build)) throw new Error('server update: build must be a positive integer')
  if (typeof commit !== 'string' || !COMMIT.test(commit)) throw new Error('server update: commit must be up to 64 of 0-9 A-Z a-z . _ -')
  if (!owner || typeof owner !== 'object') throw new Error('server update: the owner exe is missing')
  const lines = [SERVER_UPDATE_PAYLOAD_PREFIX, `version=${version}`, `build=${build}`, `commit=${commit}`, ...exeLines('owner', owner)]
  if (client === null) {
    lines.push('client=none')
  } else {
    if (!client || typeof client !== 'object') throw new Error('server update: client must be an object or null')
    lines.push(...exeLines('client', client))
    const json = client.versionJson
    if (!json || typeof json !== 'object') throw new Error('server update: the players\' version.json is missing')
    if (json.edition !== 'client') throw new Error('server update: the players\' version.json must be of the client edition')
    if (typeof json.version !== 'string' || !VERSION.test(json.version) || typeof json.commit !== 'string' || !COMMIT.test(json.commit) || !isCount(json.build)) {
      throw new Error('server update: the players\' version.json has a bad version, build or commit')
    }
    if (json.size !== client.size || json.sha256 !== client.sha256) throw new Error('server update: the players\' version.json describes another exe')
    if (typeof json.signature !== 'string' || !SIGNATURE.test(json.signature)) throw new Error('server update: the players\' version.json has no valid signature')
    lines.push(`client-version=${json.version} ${json.build} c${json.commit} ${json.size} ${json.sha256} ${json.signature}`)
  }
  return lines.join('\n')
}

async function sha256File(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** The parts of one exe in <dir> (RaidOS.part0, 1, … without gaps) with the size and SHA-256 of each and of the whole. */
async function describeParts(dir, edition) {
  const prefix = edition === 'owner' ? 'RaidOS.part' : 'RaidOSClient.part'
  const names = readdirSync(dir).filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
  names.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
  if (!names.length) return null
  const whole = createHash('sha256')
  const parts = []
  let size = 0
  for (const [index, name] of names.entries()) {
    if (name !== partName(edition, index)) throw new Error(`${dir}: expected ${partName(edition, index)}, found ${name}`)
    const file = join(dir, name)
    const partHash = createHash('sha256')
    for await (const chunk of createReadStream(file)) { partHash.update(chunk); whole.update(chunk) }
    const partSize = statSync(file).size
    parts.push({ name, size: partSize, sha256: partHash.digest('hex') })
    size += partSize
  }
  return { size, sha256: whole.digest('hex'), parts }
}

/** The signed RaidOS-update.json for the parts in `dir`; checked against `publicKey` before it is returned. */
export async function signServerUpdate({ dir, ownerInfo, clientVersionJson, privateKey, publicKey }) {
  const info = JSON.parse(readFileSync(ownerInfo, 'utf8'))
  if (info.edition !== 'owner') throw new Error(`not an owner build-info.json (edition: ${info.edition})`)
  const safe = (value) => String(value ?? '').replace(/[^0-9A-Za-z._-]/g, '')
  const owner = await describeParts(dir, 'owner')
  if (!owner) throw new Error(`${dir}: no RaidOS.part* files`)
  const clientParts = await describeParts(dir, 'client')
  let client = null
  if (clientParts) {
    if (!clientVersionJson) throw new Error('the players\' parts are there, but no signed players\' version.json was given')
    const versionJson = typeof clientVersionJson === 'string' ? JSON.parse(clientVersionJson) : clientVersionJson
    if (!versionJson.signature) throw new Error('the players\' version.json is not signed: publish it signed (no ALLOW_UNSIGNED) to make a server update')
    const { version, build, commit, edition, size, sha256, signature } = versionJson
    const checked = canonicalUpdatePayload({ edition, version, build, commit, size, sha256 })
    if (!verify(null, Buffer.from(checked, 'utf8'), publicKey, Buffer.from(String(signature), 'base64'))) throw new Error('the players\' version.json signature does not verify with electron/updateSigningKey.ts')
    client = { ...clientParts, versionJson: { version, build, commit, edition, size, sha256, signature } }
  }
  const manifest = { version: safe(info.version), build: Number(info.build) || 0, commit: safe(info.commit), owner, client }
  const payload = Buffer.from(canonicalServerUpdatePayload(manifest), 'utf8')
  const signature = sign(null, payload, privateKey).toString('base64')
  if (!verify(null, payload, publicKey, Buffer.from(signature, 'base64'))) {
    throw new Error('the signing key does not match the public key in electron/updateSigningKey.ts: nothing was signed')
  }
  return { ...manifest, signature }
}

async function main(args) {
  const [dir, ownerInfo, clientJsonArg] = args
  if (!dir || !ownerInfo) throw new Error('usage: node scripts/sign-server-update.mjs <parts dir> "<owner build-info.json>" ["<players\' version.json file or JSON text>"]')
  let clientVersionJson = clientJsonArg ?? ''
  if (clientVersionJson && !clientVersionJson.trim().startsWith('{')) clientVersionJson = readFileSync(clientVersionJson, 'utf8')
  const manifest = await signServerUpdate({ dir, ownerInfo, clientVersionJson: clientVersionJson || null, privateKey: readSigningKey(), publicKey: embeddedPublicKey() })
  writeFileSync(join(dir, SERVER_UPDATE_FILE), `${JSON.stringify(manifest, null, 1)}\n`)
  process.stdout.write(`${SERVER_UPDATE_FILE}: ${manifest.version} build ${manifest.build} · owner ${manifest.owner.parts.length} parts${manifest.client ? ` · players ${manifest.client.parts.length} parts` : ' · no players version'}\n`)
}

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
    console.error(`sign-server-update: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })
}
