import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'

/** Suffix of the temporary files below; a leftover one is an interrupted write and may be deleted. */
export const TEMPORARY_SUFFIX = '.tmp'

/**
 * Writes a file so that readers see either the old content or the whole new one, never a part: a temporary file next to
 * it, flushed to disk, then renamed over it. A failed write (a full disk) removes the temporary file and leaves the old
 * file as it was.
 */
export async function writeFileAtomic(path: string, data: string | Buffer, mode = 0o640) {
  const temporary = `${path}.${process.pid}-${randomUUID().slice(0, 8)}${TEMPORARY_SUFFIX}`
  try {
    const handle = await open(temporary, 'w', mode)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}
