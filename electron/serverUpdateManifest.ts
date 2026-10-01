import { createPublicKey, verify, type KeyObject } from 'node:crypto'
import { UPDATE_SIGNING_PUBLIC_KEY } from './updateSigningKey.js'
import { verifiedUpdateManifest } from './updateManifest.js'

/**
 * «Обновление с телефона» (docs/laptop-server.md): the signed description of one release of the server laptop,
 * `RaidOS-update.json`, made next to the chat parts by scripts/split-exe-for-chat.sh (scripts/sign-server-update.mjs).
 * It lists the owner exe and the players' (client) exe with their sizes and SHA-256, every chat part
 * (RaidOS.partN / RaidOSClient.partN) with its own size and SHA-256, and the players' signed version.json. The whole
 * text is signed with the same Ed25519 update key as the players' manifest (electron/updateManifest.ts), but under its
 * own prefix, so neither signature can be passed off as the other.
 *
 * The server (server/src/services/selfUpdate.ts) checks it when the owner uploads it and again before it assembles the
 * exes; the owner app's main process (electron/selfUpdateApply.ts) checks it a third time, with the key built into the
 * app, before it runs anything. No key ever comes from the upload. No Electron imports: shared by the API, the app,
 * the tests and (as a copy) the signing script.
 *
 * Canonical text (one field per line, «\n», no trailing newline):
 *   raidos-server-update-v1
 *   version=<version>
 *   build=<build>
 *   commit=<commit>
 *   owner=<size> <sha256> <number of parts>
 *   part=<name> <size> <sha256>                 (each owner part, in order: RaidOS.part0, RaidOS.part1, …)
 *   client=none                                  (no players' version in this release), or
 *   client=<size> <sha256> <number of parts>
 *   part=<name> <size> <sha256>                 (each client part: RaidOSClient.part0, …)
 *   client-version=<version> <build> c<commit> <size> <sha256> <signature>   (the players' signed version.json)
 */
export const SERVER_UPDATE_PAYLOAD_PREFIX = 'raidos-server-update-v1'
export const SERVER_UPDATE_FILE = 'RaidOS-update.json'
/** Largest exe the server accepts (each of the two); the exes are ~130 MB today. */
export const MAX_UPDATE_EXE_BYTES = 400 * 1024 * 1024
export const MAX_UPDATE_PARTS = 64

export interface UpdatePart { name: string; size: number; sha256: string }
export interface UpdateExe { size: number; sha256: string; parts: UpdatePart[] }
/** The players' version.json exactly as electron/localServer.ts serves it (signed by scripts/sign-client-release.mjs). */
export interface ClientVersionJson { version: string; build: number; commit: string; edition: 'client'; size: number; sha256: string; signature: string }
export interface ServerUpdateManifest {
  /** The owner build (version, build time in ms, commit) this release installs on the laptop. */
  version: string
  build: number
  commit: string
  owner: UpdateExe
  client: (UpdateExe & { versionJson: ClientVersionJson }) | null
}

const VERSION = /^[0-9A-Za-z._+-]{1,64}$/
const COMMIT = /^[0-9A-Za-z._-]{0,64}$/
const SHA256 = /^[a-f0-9]{64}$/
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** RaidOS.part0 … (owner) / RaidOSClient.part0 … (client): the names split-exe-for-chat.sh gives the parts. */
export function partName(edition: 'owner' | 'client', index: number) {
  return `${edition === 'owner' ? 'RaidOS' : 'RaidOSClient'}.part${index}`
}

function exeLines(label: 'owner' | 'client', exe: UpdateExe) {
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

/** The exact text the signature covers; throws for anything that cannot be signed unambiguously. */
export function canonicalServerUpdatePayload(manifest: ServerUpdateManifest): string {
  const { version, build, commit, owner, client } = manifest
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

function readExe(raw: unknown): UpdateExe | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const parts = Array.isArray(value.parts) ? value.parts.slice(0, MAX_UPDATE_PARTS + 1).map((part) => {
    const item = (part && typeof part === 'object' ? part : {}) as Record<string, unknown>
    return { name: item.name, size: item.size, sha256: item.sha256 } as UpdatePart
  }) : (value.parts as UpdatePart[])
  return { size: value.size as number, sha256: value.sha256 as string, parts }
}

/**
 * The signed fields of an uploaded RaidOS-update.json when its `signature` verifies with the public key (the one built
 * into the app unless a test passes its own) AND the players' version.json inside it verifies too; null otherwise.
 * Only the returned copy is to be trusted: it holds exactly the values the signature covers.
 */
export function verifiedServerUpdateManifest(data: unknown, publicKey: string | KeyObject = UPDATE_SIGNING_PUBLIC_KEY): ServerUpdateManifest | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const raw = data as Record<string, unknown>
  if (typeof raw.signature !== 'string' || !SIGNATURE.test(raw.signature)) return null
  const owner = readExe(raw.owner)
  if (!owner) return null
  let client: ServerUpdateManifest['client'] = null
  if (raw.client !== null && raw.client !== undefined) {
    const exe = readExe(raw.client)
    const json = (raw.client as Record<string, unknown>).versionJson
    if (!exe || !json || typeof json !== 'object') return null
    const v = json as Record<string, unknown>
    client = { ...exe, versionJson: { version: v.version, build: v.build, commit: v.commit, edition: v.edition, size: v.size, sha256: v.sha256, signature: v.signature } as ClientVersionJson }
  } else if (raw.client === undefined) {
    return null // «no players' version» must be said explicitly (client: null), never by leaving the field out
  }
  const manifest: ServerUpdateManifest = { version: raw.version as string, build: raw.build as number, commit: raw.commit as string, owner, client }
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
    if (key.asymmetricKeyType !== 'ed25519') return null
    if (!verify(null, Buffer.from(canonicalServerUpdatePayload(manifest), 'utf8'), key, Buffer.from(raw.signature, 'base64'))) return null
    // The players' manifest carries its own signature (the one their apps check): it must verify on its own as well.
    if (client && !verifiedUpdateManifest(client.versionJson, key)) return null
    return manifest
  } catch {
    return null
  }
}

/** Every part of a release, owner parts first. */
export function manifestParts(manifest: ServerUpdateManifest): Array<UpdatePart & { edition: 'owner' | 'client' }> {
  return [
    ...manifest.owner.parts.map((part) => ({ ...part, edition: 'owner' as const })),
    ...(manifest.client?.parts ?? []).map((part) => ({ ...part, edition: 'client' as const })),
  ]
}

/** Total bytes of all parts (the upload size). */
export function manifestBytes(manifest: ServerUpdateManifest) {
  return manifest.owner.size + (manifest.client?.size ?? 0)
}
