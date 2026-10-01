// @vitest-environment node
import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { canonicalUpdatePayload, verifiedUpdateManifest, type UpdateManifest } from './updateManifest'
import { UPDATE_SIGNING_PUBLIC_KEY } from './updateSigningKey'
import * as script from '../scripts/sign-client-release.mjs'

// Throwaway keys: the real private key is never in the repository.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')
const manifest: UpdateManifest = { edition: 'client', version: '0.5.4', build: 1790000000000, commit: 'abc1234', size: 131_072, sha256: 'ab'.repeat(32) }
const signed = (fields: UpdateManifest, key = privateKey) => ({ ...fields, signature: sign(null, Buffer.from(canonicalUpdatePayload(fields), 'utf8'), key).toString('base64') })

describe('signed update manifest (electron/updateManifest.ts)', () => {
  it('accepts a manifest signed with the matching key and returns only the signed fields', () => {
    const served = { ...signed(manifest), extra: 'ignored' }
    expect(verifiedUpdateManifest(served, publicKey)).toEqual(manifest)
  })

  it('rejects a manifest whose sha256, build, edition or any other signed field was changed', () => {
    const good = signed(manifest)
    expect(verifiedUpdateManifest({ ...good, sha256: 'cd'.repeat(32) }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, build: manifest.build + 1 }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, edition: 'owner' }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, size: manifest.size + 1 }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, version: '9.9.9' }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, commit: 'fff0000' }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...good, build: String(manifest.build) }, publicKey)).toBeNull()
  })

  it('rejects a wrong key, a missing or malformed signature and junk', () => {
    expect(verifiedUpdateManifest(signed(manifest, stranger.privateKey), publicKey)).toBeNull()
    expect(verifiedUpdateManifest(signed(manifest), stranger.publicKey)).toBeNull()
    expect(verifiedUpdateManifest(manifest, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...signed(manifest), signature: '' }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest({ ...signed(manifest), signature: 'A'.repeat(88) }, publicKey)).toBeNull()
    expect(verifiedUpdateManifest(null, publicKey)).toBeNull()
    expect(verifiedUpdateManifest('{}', publicKey)).toBeNull()
    // A key that is not Ed25519 never verifies.
    expect(verifiedUpdateManifest(signed(manifest), generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey)).toBeNull()
  })

  it('checks with the public key built into the app by default', () => {
    expect(createPublicKey(UPDATE_SIGNING_PUBLIC_KEY).asymmetricKeyType).toBe('ed25519')
    expect(verifiedUpdateManifest(signed(manifest))).toBeNull()
  })

  it('refuses fields that would make the signed text ambiguous', () => {
    expect(() => canonicalUpdatePayload({ ...manifest, version: '0.5.4\nowner' })).toThrow()
    expect(() => canonicalUpdatePayload({ ...manifest, commit: 'a\rb' })).toThrow()
    expect(() => canonicalUpdatePayload({ ...manifest, build: 0 })).toThrow()
    expect(() => canonicalUpdatePayload({ ...manifest, size: 1.5 })).toThrow()
    expect(() => canonicalUpdatePayload({ ...manifest, sha256: 'AB'.repeat(32) })).toThrow()
    expect(() => canonicalUpdatePayload({ ...manifest, edition: 'beta' as UpdateManifest['edition'] })).toThrow()
  })
})

describe('scripts/sign-client-release.mjs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'raidos-sign-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('builds exactly the same canonical text as the app', () => {
    const samples: UpdateManifest[] = [manifest, { ...manifest, edition: 'owner', version: '', commit: '' }, { ...manifest, version: '1.0.0-beta.2', build: 1, size: 1, sha256: '0'.repeat(64) }]
    for (const sample of samples) expect(script.canonicalUpdatePayload(sample)).toBe(canonicalUpdatePayload(sample))
    expect(canonicalUpdatePayload(manifest)).toBe(`raidos-update-v1\nclient\n0.5.4\n1790000000000\nabc1234\n131072\n${'ab'.repeat(32)}`)
    for (const bad of [{ ...manifest, version: 'a\nb' }, { ...manifest, build: -1 }, { ...manifest, sha256: 'x' }]) {
      expect(() => script.canonicalUpdatePayload(bad)).toThrow()
      expect(() => canonicalUpdatePayload(bad)).toThrow()
    }
  })

  it('signs a client exe so that the app accepts it, and refuses a key that does not match the embedded one', async () => {
    const exe = join(dir, 'Raid OS 0.5.4.exe')
    const buildInfo = join(dir, 'client-build-info.json')
    writeFileSync(exe, Buffer.alloc(4096, 7))
    writeFileSync(buildInfo, JSON.stringify({ version: '0.5.4', build: 1790000000000, commit: 'abc1234', edition: 'client', defaultServerUrl: 'https://raidos.app' }))
    const result = await script.signClientRelease({ exe, buildInfo, privateKey, publicKey })
    expect(Object.keys(result)).toEqual(['version', 'build', 'commit', 'edition', 'size', 'sha256', 'signature'])
    expect(result).toMatchObject({ version: '0.5.4', build: 1790000000000, commit: 'abc1234', edition: 'client', size: 4096 })
    expect(verifiedUpdateManifest(result, publicKey)).toEqual({ edition: 'client', version: '0.5.4', build: 1790000000000, commit: 'abc1234', size: 4096, sha256: result.sha256 })
    // Only characters cmd.exe echoes as they are (Server-Laptop-Setup.cmd writes this line with echo).
    expect(JSON.stringify(result)).toMatch(/^[A-Za-z0-9{}":,._+/=-]+$/)
    await expect(script.signClientRelease({ exe, buildInfo, privateKey: stranger.privateKey, publicKey })).rejects.toThrow(/does not match/)
  })

  it('refuses the owner build-info', async () => {
    const exe = join(dir, 'owner.exe')
    const buildInfo = join(dir, 'owner-build-info.json')
    writeFileSync(exe, 'MZ')
    writeFileSync(buildInfo, JSON.stringify({ version: '0.5.4', build: 1, commit: 'abc', edition: 'owner' }))
    await expect(script.signClientRelease({ exe, buildInfo, privateKey, publicKey })).rejects.toThrow(/not a client build-info/)
  })

  it('reads the key as PEM text, base64 of the PEM or a file, and never puts it in an error', () => {
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const file = join(dir, 'signing-key.pem')
    writeFileSync(file, pem)
    const derived = (key: ReturnType<typeof script.readSigningKey>) => createPublicKey(key).export({ type: 'spki', format: 'pem' })
    const expected = publicKey.export({ type: 'spki', format: 'pem' })
    expect(derived(script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY: pem }))).toBe(expected)
    expect(derived(script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY: Buffer.from(pem).toString('base64') }))).toBe(expected)
    expect(derived(script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY: pem.trim().replace(/\n/g, '\\n') }))).toBe(expected)
    expect(derived(script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY_FILE: file }))).toBe(expected)
    expect(() => script.readSigningKey({})).toThrow(/no signing key/)
    const body = pem.split('\n')[1]
    // A damaged ASN.1 header: the PEM cannot be read at all.
    const broken = pem.replace(body, `xxxxxxxx${body.slice(8)}`)
    let message = ''
    try { script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY: broken }) } catch (error) { message = String(error) }
    expect(message).toMatch(/could not be read/)
    expect(message).not.toContain(body.slice(8))
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(() => script.readSigningKey({ RAIDOS_UPDATE_SIGNING_KEY: rsa })).toThrow(/not an Ed25519 key/)
  })

  it('reads the public key from electron/updateSigningKey.ts', () => {
    expect(script.embeddedPublicKey().export({ type: 'spki', format: 'pem' })).toBe(createPublicKey(UPDATE_SIGNING_PUBLIC_KEY).export({ type: 'spki', format: 'pem' }))
  })
})
