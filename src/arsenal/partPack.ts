/**
 * The part pictures of «Сборка оружия» as one encrypted pack (owner, 22.11.2026: «нужно сделать так что бы с приложения для пк
 * и телефона не смогли вытащить и скачать снимки сборки оружия»). The renders of our offline game used to ship as 5000 plain
 * files (dist/gun-parts) that any unzip of the APK/IPA or the PC app's archive laid out; now the build writes dist/gun-parts.pack
 * instead (vite.config.ts gunPartsPack) and the apps open each picture in memory only when they draw it — the PC through its own
 * scheme (electron/gunParts.ts), the phone and the browser by fetching the pack (src/arsenal/BuildPicture.tsx).
 *
 * This keeps the pictures out of reach of copying files; it is not a lock against someone who takes the app's code apart: the
 * key is in the app, as it must be for the app to show them.
 *
 * Layout: "RAIDOSPK" | salt (16 bytes) | index length (4 bytes, little endian) | index | data. The index is JSON
 * {"<file>": [offset, length]} (offsets into the data); it and every file are AES-256-CTR, each with its own counter block
 * (SHA-256 of the salt and the file's name). WebCrypto only: the same code runs in the page, in Electron's main process and in
 * the build (Node).
 */

const MAGIC = 'RAIDOSPK'
const INDEX_NAME = '#index'

// the key from scattered pieces: not in the bundle as one readable string
const PIECES = [0x52, 0x61, 0x69, 0x64, 0x4f, 0x53, 0x2d, 0x70, 0x61, 0x72, 0x74, 0x73, 0x2f, 0x67, 0x75, 0x6e, 0x2d, 0x62, 0x65, 0x6e, 0x63, 0x68]
const SPICE = [0x3a, 0x9f, 0x11, 0xc4, 0x7e, 0x02, 0xd8, 0x65, 0xb3, 0x40, 0x2c, 0xe9, 0x58, 0x17, 0xa6, 0x81]

const subtle = () => {
  const crypto = (globalThis as { crypto?: Crypto }).crypto
  if (!crypto?.subtle) throw new Error('no WebCrypto')
  return crypto.subtle
}

let keyLoad: Promise<CryptoKey> | null = null
function packKey(): Promise<CryptoKey> {
  keyLoad ??= (async () => {
    const seed = new Uint8Array([...PIECES, ...SPICE.map((value, index) => value ^ PIECES[index % PIECES.length]!)])
    const raw = await subtle().digest('SHA-256', seed)
    return subtle().importKey('raw', raw, { name: 'AES-CTR' }, false, ['encrypt', 'decrypt'])
  })()
  return keyLoad
}

const encoder = new TextEncoder()

async function counterFor(salt: Uint8Array, name: string): Promise<Uint8Array> {
  const named = encoder.encode(name)
  const input = new Uint8Array(salt.length + named.length)
  input.set(salt)
  input.set(named, salt.length)
  return new Uint8Array(await subtle().digest('SHA-256', input)).slice(0, 16)
}

async function crypt(mode: 'encrypt' | 'decrypt', salt: Uint8Array, name: string, bytes: Uint8Array): Promise<Uint8Array> {
  const counter = await counterFor(salt, name)
  // length 128: the whole block counts on, as Node's aes-256-ctr does
  const algorithm = { name: 'AES-CTR', counter, length: 128 }
  const key = await packKey()
  // a view into the pack's own buffer (never a shared one)
  const data = bytes as Uint8Array<ArrayBuffer>
  const out = mode === 'encrypt' ? await subtle().encrypt(algorithm, key, data) : await subtle().decrypt(algorithm, key, data)
  return new Uint8Array(out)
}

/** The pack of these files (the build's step). */
export async function writePartPack(files: ReadonlyArray<readonly [string, Uint8Array]>, salt?: Uint8Array): Promise<Uint8Array> {
  const pepper = salt ?? (globalThis as { crypto: Crypto }).crypto.getRandomValues(new Uint8Array(16))
  const index: Record<string, [number, number]> = {}
  const parts: Uint8Array[] = []
  let offset = 0
  for (const [name, bytes] of files) {
    const sealed = await crypt('encrypt', pepper, name, bytes)
    index[name] = [offset, sealed.length]
    parts.push(sealed)
    offset += sealed.length
  }
  const head = await crypt('encrypt', pepper, INDEX_NAME, encoder.encode(JSON.stringify(index)))
  const out = new Uint8Array(MAGIC.length + 16 + 4 + head.length + offset)
  out.set(encoder.encode(MAGIC), 0)
  out.set(pepper, MAGIC.length)
  new DataView(out.buffer).setUint32(MAGIC.length + 16, head.length, true)
  out.set(head, MAGIC.length + 20)
  let at = MAGIC.length + 20 + head.length
  for (const part of parts) { out.set(part, at); at += part.length }
  return out
}

export interface PartPack {
  /** The files in the pack. */
  names(): string[]
  /** A file's bytes, opened; null when the pack has no such file. */
  file(name: string): Promise<Uint8Array | null>
}

/** The pack read from its bytes; null when they are not a pack. */
export async function openPartPack(bytes: Uint8Array): Promise<PartPack | null> {
  if (bytes.length < MAGIC.length + 20 || new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) return null
  const salt = bytes.slice(MAGIC.length, MAGIC.length + 16)
  const headLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length + 16, true)
  const dataStart = MAGIC.length + 20 + headLength
  if (dataStart > bytes.length) return null
  let index: Record<string, [number, number]>
  try {
    index = JSON.parse(new TextDecoder().decode(await crypt('decrypt', salt, INDEX_NAME, bytes.subarray(MAGIC.length + 20, dataStart))))
  } catch {
    return null
  }
  // nothing opened is kept here: the bench keeps the pictures it drew (BuildPicture.tsx), the PC's scheme answers each ask anew
  return {
    names: () => Object.keys(index),
    file(name) {
      const place = Object.hasOwn(index, name) ? index[name] : undefined
      if (!place) return Promise.resolve(null)
      const [offset, length] = place
      return crypt('decrypt', salt, name, bytes.subarray(dataStart + offset, dataStart + offset + length)).catch(() => null)
    },
  }
}

/** The file names the pack takes from dist/gun-parts: the index and each part's picture and depth picture. */
export const PART_PACK_FILE = /^(?:[0-9a-f]{24}(?:\.fold)?(?:\.webp|\.d\.png)|index\.json)$/
/** The pack's name next to the page. */
export const PART_PACK_NAME = 'gun-parts.pack'
