// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { openPartPack, PART_PACK_FILE, writePartPack } from './partPack'

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50, 9, 9, 9, 9, 9, 9, 9, 9, 9])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7])
const INDEX = new TextEncoder().encode('{"5447a9cd4bdc2dbd208b4567":{"w":10}}')
const has = (bytes: Uint8Array, part: Uint8Array) => {
  outer: for (let i = 0; i + part.length <= bytes.length; i++) {
    for (let j = 0; j < part.length; j++) if (bytes[i + j] !== part[j]) continue outer
    return true
  }
  return false
}

describe('«Сборка оружия»: the part pictures in one encrypted pack (owner, 22.11.2026)', () => {
  const files = [['index.json', INDEX], ['5447a9cd4bdc2dbd208b4567.webp', WEBP], ['5447a9cd4bdc2dbd208b4567.d.png', PNG]] as const

  it('gives every file back as it was, and nothing for a name it does not hold', async () => {
    const pack = (await openPartPack(await writePartPack(files)))!
    expect(pack.names().sort()).toEqual(files.map(([name]) => name).sort())
    for (const [name, bytes] of files) expect(await pack.file(name)).toEqual(bytes)
    expect(await pack.file('5447a9cd4bdc2dbd208b4568.webp')).toBeNull()
    expect(await pack.file('__proto__')).toBeNull()
  })

  it('shows no picture and no name in its bytes: an unzip of the app lays out nothing to look at', async () => {
    const bytes = await writePartPack(files)
    expect(has(bytes, new TextEncoder().encode('WEBP'))).toBe(false)
    expect(has(bytes, PNG.subarray(0, 4))).toBe(false)
    expect(has(bytes, new TextEncoder().encode('5447a9cd'))).toBe(false)
    expect(has(bytes, new TextEncoder().encode('index.json'))).toBe(false)
  })

  it('a fresh salt each time: the same pictures never pack to the same bytes', async () => {
    const one = await writePartPack(files)
    const two = await writePartPack(files)
    expect(one.length).toBe(two.length)
    expect(one.subarray(8)).not.toEqual(two.subarray(8))
  })

  it('refuses bytes that are not a pack, or a pack cut short', async () => {
    expect(await openPartPack(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(await openPartPack(WEBP)).toBeNull()
    const bytes = await writePartPack(files)
    expect(await openPartPack(bytes.subarray(0, 40))).toBeNull()
  })

  it('takes only the part pictures and their index from the folder', () => {
    for (const name of ['index.json', '5447a9cd4bdc2dbd208b4567.webp', '5447a9cd4bdc2dbd208b4567.d.png', '5447a9cd4bdc2dbd208b4567.fold.webp']) expect(PART_PACK_FILE.test(name)).toBe(true)
    for (const name of ['readme.txt', '../main.js', 'index.json.bak', '5447a9cd4bdc2dbd208b4567.png']) expect(PART_PACK_FILE.test(name)).toBe(false)
  })
})
