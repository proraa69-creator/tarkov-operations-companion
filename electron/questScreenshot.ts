import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isPositionScreenshot } from '../src/overlay/screenshotPosition.js'

/** EFT names a screenshot by the minute it was taken (local time): `2024-06-13[11-05]_…`. */
const TAKEN_AT = /^(\d{4})-(\d{2})-(\d{2})\[(\d{2})-(\d{2})\]/

/** The minute in an EFT screenshot's name, or null for any other name. */
export function screenshotNameTime(name: string) {
  const match = TAKEN_AT.exec(name)
  if (!match) return null
  const time = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime()
  return Number.isFinite(time) ? time : null
}

/**
 * Only recent files in EFT's configured screenshot folder, never arbitrary renderer paths. Runs about every second
 * while the app watches the game, and players keep thousands of screenshots: a folder untouched since the cutoff is not
 * listed at all, and a file whose name says it was taken before the cutoff is not looked up. A screenshot with
 * coordinates in its name is never one: the game writes coordinates only in a raid, and those are the minimap's
 * position shots (the game's «Скриншот» on the minimap key), never a menu to read (audit P5d).
 */
export async function readFreshQuestScreenshot(folder: string, after: number, now = Date.now()) {
  if (!Number.isFinite(after)) return null
  const cutoff = Math.max(after, now - 5 * 60_000)
  const info = await stat(folder).catch(() => null)
  // Adding a file updates the folder's time; a minute of slack for coarse file system clocks.
  if (!info?.isDirectory() || info.mtimeMs < cutoff - 60_000) return null
  const names = await readdir(folder).catch(() => [] as string[])
  const recent = names.filter((name) => {
    if (!/\.(png|jpe?g)$/i.test(name) || isPositionScreenshot(name)) return false
    const taken = screenshotNameTime(name)
    return taken === null || taken + 60_000 > cutoff
  })
  const files = await Promise.all(recent.map(async (name) => {
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
