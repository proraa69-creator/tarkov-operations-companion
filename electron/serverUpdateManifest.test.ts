// @vitest-environment node
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalUpdatePayload } from './updateManifest'
import { canonicalServerUpdatePayload, partName, SERVER_UPDATE_PAYLOAD_PREFIX, verifiedServerUpdateManifest, type ServerUpdateManifest, type UpdateExe } from './serverUpdateManifest'
import * as script from '../scripts/sign-server-update.mjs'

// Throwaway keys: the real private key is never in the repository.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')

function exe(edition: 'owner' | 'client', chunks: string[]): UpdateExe {
  return { size: chunks.join('').length, sha256: sha(chunks.join('')), parts: chunks.map((chunk, index) => ({ name: partName(edition, index), size: chunk.length, sha256: sha(chunk) })) }
}

function signedRelease(fields: { version?: string; build?: number; commit?: string; owner?: string[]; client?: string[] | null } = {}, key: KeyObject = privateKey) {
  const owner = exe('owner', fields.owner ?? ['owner-part-0', 'owner-part-1'])
  let client: ServerUpdateManifest['client'] = null
  if (fields.client !== null) {
    const clientExe = exe('client', fields.client ?? ['client-0', 'client-1', 'client-2'])
    const base = { edition: 'client' as const, version: '0.5.5', build: 1_790_000_000_001, commit: 'abc1234', size: clientExe.size, sha256: clientExe.sha256 }
    const versionJson = { ...base, signature: sign(null, Buffer.from(canonicalUpdatePayload(base), 'utf8'), key).toString('base64') }
    client = { ...clientExe, versionJson }
  }
  const manifest: ServerUpdateManifest = { version: fields.version ?? '0.5.5', build: fields.build ?? 1_790_000_000_000, commit: fields.commit ?? 'abc1234', owner, client }
  return { ...manifest, signature: sign(null, Buffer.from(canonicalServerUpdatePayload(manifest), 'utf8'), key).toString('base64') }
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

describe('signed server update manifest (electron/serverUpdateManifest.ts)', () => {
  it('accepts a release signed with the matching key and returns only the signed fields', () => {
    const release = signedRelease()
    const { signature: _signature, ...fields } = release
    void _signature
    expect(verifiedServerUpdateManifest({ ...release, extra: 'ignored' }, publicKey)).toEqual(fields)
    expect(verifiedServerUpdateManifest(signedRelease({ client: null }), publicKey)?.client).toBeNull()
  })

  it('rejects any change to a signed field (tamper → reject)', () => {
    const good = signedRelease()
    const tampered: Array<(value: ReturnType<typeof signedRelease>) => void> = [
      (value) => { value.build += 1 },
      (value) => { value.version = '9.9.9' },
      (value) => { value.commit = 'fff0000' },
      (value) => { value.owner.sha256 = 'cd'.repeat(32) },
      (value) => { value.owner.parts[1]!.sha256 = 'cd'.repeat(32) },
      (value) => { value.owner.parts[0]!.size += 1; value.owner.parts[1]!.size -= 1 },
      (value) => { value.owner.parts.pop(); value.owner.size = value.owner.parts[0]!.size },
      (value) => { value.client!.parts[2]!.sha256 = 'ef'.repeat(32) },
      (value) => { value.client!.versionJson.build += 1 },
      (value) => { value.client = null },
      (value) => { delete (value as Partial<typeof value>).client },
    ]
    for (const change of tampered) {
      const copy = clone(good)
      change(copy)
      expect(verifiedServerUpdateManifest(copy, publicKey)).toBeNull()
    }
  })

  it('rejects a wrong key, a missing or malformed signature, and junk', () => {
    expect(verifiedServerUpdateManifest(signedRelease({}, stranger.privateKey), publicKey)).toBeNull()
    expect(verifiedServerUpdateManifest(signedRelease(), stranger.publicKey)).toBeNull()
    const { signature: _signature, ...unsigned } = signedRelease()
    void _signature
    expect(verifiedServerUpdateManifest(unsigned, publicKey)).toBeNull()
    expect(verifiedServerUpdateManifest({ ...signedRelease(), signature: 'A'.repeat(86) + '==' }, publicKey)).toBeNull()
    expect(verifiedServerUpdateManifest(null, publicKey)).toBeNull()
    expect(verifiedServerUpdateManifest([], publicKey)).toBeNull()
    expect(verifiedServerUpdateManifest(signedRelease(), generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey)).toBeNull()
    // The app's own key is the default: a throwaway-key release never verifies with it.
    expect(verifiedServerUpdateManifest(signedRelease())).toBeNull()
  })

  it('never accepts the players\' manifest signature as a server release signature (distinct prefix)', () => {
    const release = signedRelease()
    expect(canonicalServerUpdatePayload(release).startsWith(`${SERVER_UPDATE_PAYLOAD_PREFIX}\n`)).toBe(true)
    // The players' version.json signed by an unrelated key inside an otherwise correctly signed release: rejected.
    const forged = clone(release)
    const base = { edition: 'client' as const, version: forged.client!.versionJson.version, build: forged.client!.versionJson.build, commit: forged.client!.versionJson.commit, size: forged.client!.size, sha256: forged.client!.sha256 }
    forged.client!.versionJson.signature = sign(null, Buffer.from(canonicalUpdatePayload(base), 'utf8'), stranger.privateKey).toString('base64')
    const { signature: _signature, ...fields } = forged
    void _signature
    const resigned = { ...fields, signature: sign(null, Buffer.from(canonicalServerUpdatePayload(fields), 'utf8'), privateKey).toString('base64') }
    expect(verifiedServerUpdateManifest(resigned, publicKey)).toBeNull()
  })

  it('refuses fields that would make the signed text ambiguous', () => {
    const { signature: _signature, ...fields } = signedRelease()
    void _signature
    expect(() => canonicalServerUpdatePayload({ ...fields, version: '0.5.5\nbuild=1' })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, version: '0.5 5' })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, commit: 'a b' })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, build: 0 })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, owner: { ...fields.owner, parts: [{ ...fields.owner.parts[0]!, name: '../evil' }, fields.owner.parts[1]!] } })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, owner: { ...fields.owner, size: fields.owner.size + 1 } })).toThrow()
    expect(() => canonicalServerUpdatePayload({ ...fields, client: { ...fields.client!, versionJson: { ...fields.client!.versionJson, size: 1 } } })).toThrow()
  })
})

describe('scripts/sign-server-update.mjs', () => {
  const dirs: string[] = []
  afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

  it('builds the same canonical text as the app', () => {
    const { signature: _signature, ...fields } = signedRelease()
    void _signature
    expect(script.canonicalServerUpdatePayload(fields)).toBe(canonicalServerUpdatePayload(fields))
    const ownerOnly = { ...fields, client: null }
    expect(script.canonicalServerUpdatePayload(ownerOnly)).toBe(canonicalServerUpdatePayload(ownerOnly))
  })

  it('signs the parts in a folder into a manifest the app accepts, and refuses an unsigned players\' version', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'raidos-sign-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'RaidOS.part0'), 'owner-AAAA')
    writeFileSync(join(dir, 'RaidOS.part1'), 'owner-BB')
    writeFileSync(join(dir, 'RaidOSClient.part0'), 'client-CC')
    writeFileSync(join(dir, 'owner-info.json'), JSON.stringify({ version: '0.5.6', build: 1_790_000_000_500, commit: 'beef123', edition: 'owner' }))
    const clientBase = { edition: 'client', version: '0.5.6', build: 1_790_000_000_400, commit: 'beef123', size: 9, sha256: sha('client-CC') }
    const versionJson = { ...clientBase, signature: sign(null, Buffer.from(canonicalUpdatePayload(clientBase as never), 'utf8'), privateKey).toString('base64') }
    const manifest = await script.signServerUpdate({ dir, ownerInfo: join(dir, 'owner-info.json'), clientVersionJson: JSON.stringify(versionJson), privateKey, publicKey })
    const verified = verifiedServerUpdateManifest(manifest, publicKey)
    expect(verified?.owner).toEqual({ size: 18, sha256: sha('owner-AAAAowner-BB'), parts: [{ name: 'RaidOS.part0', size: 10, sha256: sha('owner-AAAA') }, { name: 'RaidOS.part1', size: 8, sha256: sha('owner-BB') }] })
    expect(verified?.client?.versionJson).toEqual(versionJson)
    expect(verified?.build).toBe(1_790_000_000_500)
    await expect(script.signServerUpdate({ dir, ownerInfo: join(dir, 'owner-info.json'), clientVersionJson: JSON.stringify(clientBase), privateKey, publicKey })).rejects.toThrow(/not signed/)
    await expect(script.signServerUpdate({ dir, ownerInfo: join(dir, 'owner-info.json'), clientVersionJson: JSON.stringify(versionJson), privateKey: stranger.privateKey, publicKey })).rejects.toThrow()
  })
})
