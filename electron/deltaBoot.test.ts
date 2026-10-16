// @vitest-environment node
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { chooseBoot, confirmBoot, deltaRoot, markBad, readDeltaState, stagedBuildVerified, writeDeltaState, type DeltaState } from './deltaBoot'
import { canonicalDeltaPayload, STAGED_INFO, type DeltaInfo } from './deltaInfo'

const PACKAGED = { edition: 'owner', build: 1791000000000 }
const NEW = 1792000000000
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function staged(state: DeltaState = { current: { build: NEW, version: '0.5.5', commit: 'c', dir: String(NEW) } }) {
  const root = mkdtempSync(join(tmpdir(), 'raidos-boot-'))
  dirs.push(root)
  mkdirSync(join(root, String(NEW)), { recursive: true })
  writeFileSync(join(root, String(NEW), 'app.asar'), 'archive')
  writeDeltaState(fs, root, state)
  return root
}

const dead = () => false
const alive = () => true

describe('which build the owner app starts (partial update)', () => {
  it('starts a newer staged build and marks this start pending until the page loads', () => {
    const root = staged()
    const choice = chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(choice).toEqual({ build: NEW, main: join(root, String(NEW), 'app.asar', 'dist-electron', 'electron', 'main.js') })
    expect(readDeltaState(fs, root).pending).toEqual({ build: NEW, pid: 100 })
    expect(confirmBoot(fs, root, 999)).toBe(false)
    expect(confirmBoot(fs, root, 100)).toBe(true)
    expect(readDeltaState(fs, root).pending).toBeUndefined()
    expect(readDeltaState(fs, root).confirmed).toEqual([NEW])
    // Confirmed once: later starts need no pending mark.
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 200, alive: dead })?.build).toBe(NEW)
    expect(readDeltaState(fs, root).pending).toBeUndefined()
  })

  it('goes back to the exe\'s own build when the last start never loaded its page', () => {
    const root = staged()
    chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 101, alive: dead })).toBeNull()
    expect(readDeltaState(fs, root).bad).toEqual([NEW])
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 102, alive: dead })).toBeNull()
  })

  it('a second launch while the first still runs is not a failure', () => {
    const root = staged()
    chooseBoot({ fs, root, packaged: PACKAGED, pid: 100, alive: dead })
    expect(chooseBoot({ fs, root, packaged: PACKAGED, pid: 101, alive })?.build).toBe(NEW)
    expect(readDeltaState(fs, root).pending).toEqual({ build: NEW, pid: 100 })
  })

  it('never for an unverified players\' build, an older staged build, a bad one or a missing archive', () => {
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, edition: 'client' }, pid: 1, alive: dead })).toBeNull()
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, edition: 'client' }, pid: 1, alive: dead, verify: () => false })).toBeNull()
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, edition: 'other' }, pid: 1, alive: dead, verify: () => true })).toBeNull()
    expect(chooseBoot({ fs, root: staged(), packaged: { ...PACKAGED, build: NEW }, pid: 1, alive: dead })).toBeNull()
    const bad = staged()
    markBad(fs, bad, NEW)
    expect(chooseBoot({ fs, root: bad, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    const missing = staged()
    rmSync(join(missing, String(NEW)), { recursive: true })
    expect(chooseBoot({ fs, root: missing, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    // A state file pointing outside its folder is ignored.
    const outside = staged({ current: { build: NEW, version: 'x', commit: 'c', dir: '../elsewhere' } })
    expect(chooseBoot({ fs, root: outside, packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
    expect(chooseBoot({ fs, root: join(tmpdir(), 'raidos-no-such-folder'), packaged: PACKAGED, pid: 1, alive: dead })).toBeNull()
  })
})

describe('which build a player\'s app starts (partial update, owner 11.10.2026)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const stranger = generateKeyPairSync('ed25519').privateKey
  const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

  /** A staged players' build as stageDelta leaves it: the archive and the release's signed delta-info.json. */
  function stagedRelease(options: { key?: typeof privateKey; build?: number } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'raidos-boot-client-'))
    dirs.push(root)
    const dir = join(root, String(NEW))
    mkdirSync(dir, { recursive: true })
    const archive = randomBytes(4096)
    writeFileSync(join(dir, 'app.asar'), archive)
    const info: DeltaInfo = { format: 1, build: options.build ?? NEW, version: '0.6.0-13', commit: 'c-production', electron: '44.4.5', asar: { size: archive.length, dataStart: 512, sha256: sha256(archive), headerSha256: sha256(archive.subarray(0, 512)) }, resources: { 'tessdata/rus.traineddata': 'a'.repeat(64) } }
    info.signature = sign(null, Buffer.from(canonicalDeltaPayload(info), 'utf8'), options.key ?? privateKey).toString('base64')
    writeFileSync(join(dir, STAGED_INFO), JSON.stringify(info))
    writeDeltaState(fs, root, { current: { build: NEW, version: '0.6.0-13', commit: 'c-production', dir: String(NEW) } })
    return { root, dir }
  }
  const client = { edition: 'client', build: PACKAGED.build }
  const verify = (dir: string, build: number) => stagedBuildVerified(fs, dir, build, publicPem)

  it('starts the release exactly as signed', () => {
    const { root, dir } = stagedRelease()
    expect(stagedBuildVerified(fs, dir, NEW, publicPem)).toBe(true)
    expect(chooseBoot({ fs, root, packaged: client, pid: 100, alive: dead, verify })).toEqual({ build: NEW, main: join(dir, 'app.asar', 'dist-electron', 'electron', 'main.js') })
    expect(readDeltaState(fs, root).pending).toEqual({ build: NEW, pid: 100 })
  })

  it('not a changed archive, another key\'s signature, another build or a missing manifest', () => {
    const header = stagedRelease()
    const bytes = readFileSync(join(header.dir, 'app.asar'))
    bytes[10] ^= 0xff
    writeFileSync(join(header.dir, 'app.asar'), bytes)
    expect(chooseBoot({ fs, root: header.root, packaged: client, pid: 1, alive: dead, verify })).toBeNull()
    const longer = stagedRelease()
    writeFileSync(join(longer.dir, 'app.asar'), Buffer.concat([readFileSync(join(longer.dir, 'app.asar')), Buffer.from('x')]))
    expect(stagedBuildVerified(fs, longer.dir, NEW, publicPem)).toBe(false)
    expect(stagedBuildVerified(fs, stagedRelease({ key: stranger }).dir, NEW, publicPem)).toBe(false)
    expect(stagedBuildVerified(fs, stagedRelease({ build: NEW + 1 }).dir, NEW, publicPem)).toBe(false)
    const missing = stagedRelease()
    rmSync(join(missing.dir, STAGED_INFO))
    expect(stagedBuildVerified(fs, missing.dir, NEW, publicPem)).toBe(false)
    // Nothing was marked bad: the exe's own build simply starts.
    expect(readDeltaState(fs, header.root).bad ?? []).toEqual([])
  })

  it('keeps its staged builds apart from the owner\'s', () => {
    expect(deltaRoot('/data')).toBe(join('/data', 'Raid OS Updates'))
    expect(deltaRoot('/data', 'owner')).toBe(join('/data', 'Raid OS Updates'))
    expect(deltaRoot('/data', 'client')).toBe(join('/data', 'Raid OS Updates', 'client'))
  })
})
