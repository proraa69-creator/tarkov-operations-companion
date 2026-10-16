import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'raidos-shots-'))
vi.mock('electron', () => ({ app: { getPath: () => join(root, 'documents') } }))
// Documents moved to OneDrive: EFT writes there (the app also looks under the OneDrive folder).
const savedOneDrive = process.env.OneDrive
process.env.OneDrive = join(root, 'onedrive')

const { FOLDER_CACHE_MS, findScreenshotsFolder, PositionTracker, screenshotFolderCandidates, screenshotsFolder, setScreenshotsOverride, watchedScreenshotFolders } = await import('./positionTracker')

const shot = (taken: string, x = 10) => `${taken}_${x}.5, 3.2, -77.1_0.02, -0.84, 0.03, 0.54_11.02 (0).png`
function folderWith(base: string, files: Array<[string, number]>) {
  const folder = join(base, 'Escape from Tarkov', 'Screenshots')
  mkdirSync(folder, { recursive: true })
  for (const [name, at] of files) {
    writeFileSync(join(folder, name), 'png')
    utimesSync(join(folder, name), at / 1000, at / 1000)
  }
  return folder
}

afterAll(() => {
  if (savedOneDrive === undefined) Reflect.deleteProperty(process.env, 'OneDrive')
  else process.env.OneDrive = savedOneDrive
  rmSync(root, { recursive: true, force: true })
})

describe('EFT screenshots folder', () => {
  it('follows the folder the game wrote coordinate screenshots to last, by their names', async () => {
    const old = Date.parse('2026-10-01T10:00:00Z')
    // Thousands of old screenshots in Documents; the game now writes to OneDrive's Documents.
    const documents = folderWith(join(root, 'documents'), Array.from({ length: 300 }, (_, index) => [shot(`2026-09-${String(1 + (index % 28)).padStart(2, '0')}[10-${String(index % 60).padStart(2, '0')}]`), old] as [string, number]))
    const onedrive = folderWith(join(root, 'onedrive', 'Documents'), [[shot('2026-10-12[18-40]'), old + 60_000]])
    setScreenshotsOverride('')
    expect(await findScreenshotsFolder()).toBe(onedrive)
    expect(screenshotsFolder()).toBe(onedrive)
    expect(documents).not.toBe(onedrive)
  })

  it('answers at once from the last lookup, and looks again in the background only after a while', async () => {
    const found = await findScreenshotsFolder()
    // Even a folder that would win now does not change the answer before the cache is old: nothing is listed.
    const newer = folderWith(join(root, 'documents'), [[shot('2026-10-13[09-00]'), Date.parse('2026-10-13T09:00:00Z')]])
    expect(screenshotsFolder()).toBe(found)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(Date.now() + FOLDER_CACHE_MS)
      // Old now: this call still answers at once and starts a lookup; the next ones get its answer.
      expect(screenshotsFolder()).toBe(found)
      expect(await findScreenshotsFolder()).toBe(newer)
      expect(screenshotsFolder()).toBe(newer)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports the position of a new screenshot', async () => {
    const folder = screenshotsFolder()
    const positions: Array<{ x: number }> = []
    const tracker = new PositionTracker((position) => positions.push(position))
    await tracker.start()
    try {
      writeFileSync(join(folder, shot('2026-10-12[18-45]', 42)), 'png')
      await vi.waitFor(() => expect(positions.at(-1)?.x).toBe(42.5), { timeout: 4000 })
    } finally {
      tracker.stop()
    }
  })

  it('reads the name of a file the game is still writing (no size yet)', async () => {
    const folder = screenshotsFolder()
    const positions: Array<{ x: number }> = []
    const tracker = new PositionTracker((position) => positions.push(position))
    await tracker.start()
    try {
      writeFileSync(join(folder, shot('2026-10-12[18-46]', 43)), '')
      await vi.waitFor(() => expect(positions.at(-1)?.x).toBe(43.5), { timeout: 4000 })
    } finally {
      tracker.stop()
    }
  })
})

describe('every place the game may write to is followed (the dot from the first screenshot)', () => {
  it('follows Windows\' Documents, the profile\'s Documents and OneDrive\'s, whichever the lookup chose', () => {
    const watched = watchedScreenshotFolders()
    for (const folder of screenshotFolderCandidates()) expect(watched).toContain(folder)
    expect(screenshotFolderCandidates()).toContain(join(root, 'documents', 'Escape from Tarkov', 'Screenshots'))
    expect(screenshotFolderCandidates()).toContain(join(root, 'onedrive', 'Documents', 'Escape from Tarkov', 'Screenshots'))
  })

  it('a screenshot in another candidate folder than the one found counts at once', async () => {
    const other = watchedScreenshotFolders().find((folder) => folder !== screenshotsFolder() && folder.startsWith(root))!
    mkdirSync(other, { recursive: true })
    const positions: Array<{ x: number }> = []
    const files: string[] = []
    const tracker = new PositionTracker((position, file) => { positions.push(position); files.push(file.folder) })
    await tracker.start()
    try {
      writeFileSync(join(other, shot('2026-10-12[18-50]', 44)), 'png')
      await vi.waitFor(() => expect(positions.at(-1)?.x).toBe(44.5), { timeout: 4000 })
      expect(files.at(-1)).toBe(other)
      expect(tracker.lastSeen).toMatchObject({ folder: other, withCoordinates: true, position: { x: 44.5 } })
    } finally {
      tracker.stop()
    }
  })

  it('a Screenshots folder the game creates at its first screenshot (absent at the start)', async () => {
    setScreenshotsOverride(join(root, 'custom', 'Shots'))
    const late = join(root, 'custom', 'Shots')
    const positions: Array<{ x: number }> = []
    const tracker = new PositionTracker((position) => positions.push(position))
    await tracker.start()
    try {
      expect(tracker.folders).toContainEqual({ folder: late, exists: false, watching: false })
      mkdirSync(late, { recursive: true })
      writeFileSync(join(late, shot('2026-10-12[18-55]', 45)), 'png')
      await vi.waitFor(() => expect(positions.at(-1)?.x).toBe(45.5), { timeout: 4000 })
      await vi.waitFor(() => expect(tracker.folders).toContainEqual({ folder: late, exists: true, watching: true }), { timeout: 4000 })
    } finally {
      tracker.stop()
      setScreenshotsOverride('')
    }
  })

  it('reports the newest kept screenshot after a restart, and nothing old as new', async () => {
    const positions: Array<{ x: number }> = []
    const tracker = new PositionTracker((position) => positions.push(position))
    await tracker.start()
    try {
      // The newest coordinate screenshot of all followed folders (x 44.5 above; the custom folder is no longer picked).
      expect(positions).toHaveLength(1)
      expect(positions.at(-1)?.x).toBe(44.5)
      expect(tracker.lastSeen).toBeNull()
    } finally {
      tracker.stop()
    }
  })

  it('stopped while starting: no watch and no position are left behind', async () => {
    const positions: Array<{ x: number }> = []
    const tracker = new PositionTracker((position) => positions.push(position))
    const starting = tracker.start()
    tracker.stop()
    await starting
    expect(tracker.running).toBe(false)
    expect(tracker.folders).toEqual([])
    writeFileSync(join(screenshotsFolder(), shot('2026-10-12[19-00]', 46)), 'png')
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(positions).toEqual([])
  })
})
