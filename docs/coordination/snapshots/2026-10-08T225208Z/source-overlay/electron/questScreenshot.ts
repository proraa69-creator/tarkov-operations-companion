import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Only recent files in EFT's configured screenshot folder, never arbitrary renderer paths. */
export async function readFreshQuestScreenshot(folder: string, after: number, now = Date.now()) {
  if (!Number.isFinite(after)) return null
  const cutoff = Math.max(after, now - 5 * 60_000)
  const names = await readdir(folder).catch(() => [] as string[])
  const files = await Promise.all(names.filter((name) => /\.(png|jpe?g)$/i.test(name)).map(async (name) => {
    const file = join(folder, name)
    const info = await stat(file).catch(() => null)
    return info?.isFile() && info.mtimeMs > cutoff && info.mtimeMs <= now && info.size > 0 && info.size <= 20 * 1024 * 1024
      ? { file, size: info.size, modifiedAt: info.mtimeMs } : null
  }))
  const newest = files.filter((file): file is NonNullable<typeof file> => file != null).sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
  if (!newest) return null
  const data = await readFile(newest.file).catch(() => null)
  const checked = await stat(newest.file).catch(() => null)
  // A game screenshot can still be writing when fs.watch/poll first notices it.
  if (!data || !checked || checked.size !== newest.size || checked.mtimeMs !== newest.modifiedAt || data.length !== newest.size) return null
  return { ...newest, data }
}
