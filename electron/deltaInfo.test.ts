// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalDeltaPayload, deltaSignatureValid, parseDeltaInfo, type DeltaInfo } from './deltaInfo'
import * as script from '../scripts/sign-client-release.mjs'

// Throwaway keys: the real private key is never in the repository.
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519').privateKey
const info: DeltaInfo = {
  format: 1, build: 1792000000000, version: '0.6.0-13', commit: '5d49ed6fbdb42741492a1760252147283389b85d-production', electron: '44.4.5',
  asar: { size: 149_584_530, dataStart: 1_765_284, sha256: 'a'.repeat(64), headerSha256: 'b'.repeat(64) },
  resources: { 'tessdata/rus.traineddata': 'c'.repeat(64), 'koffi/win32_x64/koffi.node': 'd'.repeat(64), 'tessdata/eng.traineddata': 'e'.repeat(64) },
}
const signed = (fields: DeltaInfo, key = privateKey) => ({ ...fields, signature: sign(null, Buffer.from(canonicalDeltaPayload(fields), 'utf8'), key).toString('base64') })

describe('signed partial update manifest (electron/deltaInfo.ts)', () => {
  it('the release signs exactly the text the app checks (scripts/sign-client-release.mjs keeps its own copy)', () => {
    expect(script.canonicalDeltaPayload(info)).toBe(canonicalDeltaPayload(info))
    expect(script.DELTA_PAYLOAD_PREFIX).toBe('raidos-app-delta-v1')
    const broken: Array<Partial<DeltaInfo>> = [
      { asar: { ...info.asar, sha256: undefined } },
      { asar: { ...info.asar, headerSha256: 'B'.repeat(64) } },
      { version: '0.6.0\n13' },
      { build: 0 },
      { resources: { 'tessdata/rus.traineddata': 'not-a-hash' } },
    ]
    for (const change of broken) {
      expect(() => canonicalDeltaPayload({ ...info, ...change })).toThrow()
      expect(() => script.canonicalDeltaPayload({ ...info, ...change })).toThrow()
    }
  })

  it('verifies only the update key\'s signature over exactly these fields', () => {
    const served = parseDeltaInfo(JSON.parse(JSON.stringify(signed(info))))!
    expect(deltaSignatureValid(served, publicKey)).toBe(true)
    expect(deltaSignatureValid(parseDeltaInfo(signed(info, stranger))!, publicKey)).toBe(false)
    expect(deltaSignatureValid({ ...served, build: served.build + 1 }, publicKey)).toBe(false)
    expect(deltaSignatureValid({ ...served, asar: { ...served.asar, sha256: 'f'.repeat(64) } }, publicKey)).toBe(false)
    expect(deltaSignatureValid({ ...served, resources: { ...served.resources, 'extra.dll': 'f'.repeat(64) } }, publicKey)).toBe(false)
    expect(deltaSignatureValid(parseDeltaInfo(info)!, publicKey)).toBe(false)
  })
})
