import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLogFolderCandidates, buildUserLogFolderCandidates, freshestLogsFolder, launchTime, parseLauncherGamesRoot } from './logDiscovery.js'

describe('EFT log discovery', () => {
  it('reads the games root from BSG Launcher settings', () => {
    expect(parseLauncherGamesRoot(JSON.stringify({ gamesRootDir: 'D:\\Battlestate Games' })))
      .toBe('D:\\Battlestate Games')
  })

  it('ignores damaged launcher settings', () => {
    expect(parseLauncherGamesRoot('{damaged')).toBeUndefined()
  })

  it('prioritizes the launcher root and supports current and legacy folder names', () => {
    const candidates = buildLogFolderCandidates('D:\\Battlestate Games', ['C:', 'D:'])

    expect(candidates[0]).toBe('D:\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(candidates).toContain('D:\\Battlestate Games\\EFT\\Logs')
    expect(candidates).toContain('C:\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('knows the Steam version\'s folders too', () => {
    const candidates = buildLogFolderCandidates(undefined, ['D:'])
    expect(candidates).toContain('D:\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\build\\Logs')
  })

  it('checks per-user locations when the launcher does not expose the install root', () => {
    const candidates = buildUserLogFolderCandidates('C:\\Users\\Tester\\AppData\\Roaming')
    expect(candidates).toContain('C:\\Users\\Tester\\AppData\\Local\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(candidates).toContain('C:\\Users\\Tester\\Documents\\Escape from Tarkov\\Logs')
  })

  it('reads the launch time from the folder name (the hour is not zero-padded)', () => {
    expect(launchTime('log_2026.09.27_2-33-45_1.1.5.1')).toBe(Date.UTC(2026, 8, 27, 2, 33, 45))
    expect(launchTime('notes')).toBe(0)
  })

  it('takes the Logs folder the game started in last, not an old one that still exists (owner, 12.10.2026)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raidos-logs-'))
    const old = join(root, 'C', 'Battlestate Games', 'EFT', 'Logs')
    const current = join(root, 'D', 'Games', 'Escape from Tarkov', 'Logs')
    await mkdir(join(old, 'log_2026.09.28_19-02-11_1.1.4.0'), { recursive: true })
    await mkdir(join(current, 'log_2026.10.12_8-15-00_1.1.5.1'), { recursive: true })
    await mkdir(join(current, 'log_2026.10.01_21-40-02_1.1.5.1'), { recursive: true })
    expect(await freshestLogsFolder([old, current])).toBe(current)
    expect(await freshestLogsFolder([current, old])).toBe(current)
    expect(await freshestLogsFolder([undefined, old])).toBe(old)
    expect(await freshestLogsFolder([])).toBeUndefined()
  })
})
