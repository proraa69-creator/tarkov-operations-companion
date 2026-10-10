import { createHash } from 'node:crypto'

/**
 * Electron's asar archive (resources/app.asar), only what the partial update (electron/appDelta.ts) needs: the header and
 * where each file's bytes are. Layout, as @electron/asar writes it:
 *
 *   [uint32 4][uint32 N]                 a Chromium pickle holding N, the size of the header pickle
 *   [uint32 payload][int32 len][json…]   the header pickle: the JSON tree, padded to 4 bytes
 *   file data…                           a file's `offset` (a decimal string) counts from here, 8 + N
 *
 * A file is { size, offset, integrity }, or { size, unpacked: true, integrity } when it lives next to the archive in
 * app.asar.unpacked (native modules); `integrity.hash` is the SHA-256 of the whole file. No Electron imports: the tests,
 * the boot code and the build script share it.
 */
export interface AsarIntegrity { algorithm: 'SHA256'; hash: string; blockSize: number; blocks: string[] }
export interface AsarFile { size: number; offset?: string; unpacked?: boolean; executable?: boolean; integrity?: AsarIntegrity }
export interface AsarLink { link: string }
export interface AsarDirectory { files: Record<string, AsarNode>; unpacked?: boolean }
export type AsarNode = AsarDirectory | AsarFile | AsarLink

/** Integrity blocks of 4 MiB, as @electron/asar writes them. */
export const INTEGRITY_BLOCK_SIZE = 4 * 1024 * 1024
/** A header larger than this is not an app archive (the real one is well under 1 MiB). */
const MAX_HEADER = 32 * 1024 * 1024

export const isDirectory = (node: AsarNode): node is AsarDirectory => 'files' in node
export const isLink = (node: AsarNode): node is AsarLink => 'link' in node

/** Size of the header pickle from the first 8 bytes; the file data starts at 8 + this. */
export function headerPickleSize(prefix: Buffer) {
  if (prefix.length < 8 || prefix.readUInt32LE(0) !== 4) throw new Error('asar: not an archive')
  const size = prefix.readUInt32LE(4)
  if (size < 8 || size > MAX_HEADER) throw new Error('asar: header size out of range')
  return size
}

/** The JSON tree from the header pickle (the `headerPickleSize` bytes after the first 8). */
export function parseHeader(pickle: Buffer): AsarDirectory {
  if (pickle.length < 8) throw new Error('asar: header too short')
  const payload = pickle.readUInt32LE(0)
  const length = pickle.readInt32LE(4)
  if (payload + 4 !== pickle.length || length < 0 || 8 + length > pickle.length) throw new Error('asar: damaged header')
  const tree = JSON.parse(pickle.toString('utf8', 8, 8 + length)) as unknown
  if (!tree || typeof tree !== 'object' || !('files' in tree)) throw new Error('asar: header without files')
  return tree as AsarDirectory
}

/** The archive's first bytes for this tree: the size pickle and the header pickle. */
export function serializeHeader(tree: AsarDirectory): Buffer {
  const json = Buffer.from(JSON.stringify(tree), 'utf8')
  const padded = Math.ceil(json.length / 4) * 4
  const header = Buffer.alloc(8 + padded)
  header.writeUInt32LE(4 + padded, 0)
  header.writeInt32LE(json.length, 4)
  json.copy(header, 8)
  const size = Buffer.alloc(8)
  size.writeUInt32LE(4, 0)
  size.writeUInt32LE(header.length, 4)
  return Buffer.concat([size, header])
}

/** Every file of the tree (not directories or links) with its path, '/'-separated. */
export function listFiles(tree: AsarDirectory, prefix = ''): Array<{ path: string; file: AsarFile }> {
  const out: Array<{ path: string; file: AsarFile }> = []
  for (const [name, node] of Object.entries(tree.files)) {
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) throw new Error(`asar: unsafe name ${JSON.stringify(name)}`)
    const path = prefix ? `${prefix}/${name}` : name
    if (isDirectory(node)) out.push(...listFiles(node, path))
    else if (!isLink(node)) out.push({ path, file: node })
  }
  return out
}

/** The entry at `path` ('/'-separated), or undefined. */
export function entryAt(tree: AsarDirectory, path: string): AsarNode | undefined {
  let node: AsarNode = tree
  for (const name of path.split('/')) {
    if (!isDirectory(node)) return undefined
    const next: AsarNode | undefined = node.files[name]
    if (!next) return undefined
    node = next
  }
  return node
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex')

/** The integrity record @electron/asar would write for these bytes (full blocks, then always the rest, even empty). */
export function integrityOf(data: Buffer): AsarIntegrity {
  const blocks: string[] = []
  let start = 0
  for (; start + INTEGRITY_BLOCK_SIZE <= data.length; start += INTEGRITY_BLOCK_SIZE) blocks.push(sha256(data.subarray(start, start + INTEGRITY_BLOCK_SIZE)))
  blocks.push(sha256(data.subarray(start)))
  return { algorithm: 'SHA256', hash: sha256(data), blockSize: INTEGRITY_BLOCK_SIZE, blocks }
}
