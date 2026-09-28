import { readdir, unlink, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

export const MAX_SCAN_FRAMES = 10

export function scanFramesDirectory() {
  return join(app.getPath('userData'), 'quest-scan-frames')
}

/** Keep only the newest `keep` PNG frames under the scan buffer folder. */
export async function pruneScanFrames(directory: string, keep = MAX_SCAN_FRAMES) {
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter((name) => /\.png$/i.test(name))
    .sort()
  const excess = names.length - keep
  if (excess <= 0) return names.length
  for (const name of names.slice(0, excess)) {
    await unlink(join(directory, name)).catch(() => undefined)
  }
  return Math.min(names.length, keep)
}

export async function saveScanFrame(png: Buffer) {
  const directory = scanFramesDirectory()
  await mkdir(directory, { recursive: true })
  const file = join(directory, `frame-${Date.now()}-${Math.floor(Math.random() * 1e4)}.png`)
  await writeFile(file, png)
  return pruneScanFrames(directory, MAX_SCAN_FRAMES)
}

export async function clearScanFrames() {
  const directory = scanFramesDirectory()
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter((name) => /\.png$/i.test(name))
  for (const name of names) {
    await unlink(join(directory, name)).catch(() => undefined)
  }
  return 0
}

export async function countScanFrames() {
  const directory = scanFramesDirectory()
  const names = (await readdir(directory).catch(() => [] as string[]))
    .filter((name) => /\.png$/i.test(name))
  return names.length
}
