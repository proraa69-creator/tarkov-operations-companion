import { describe, expect, it } from 'vitest'
import { buildLogFolderCandidates, parseLauncherGamesRoot } from './logDiscovery.js'

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
})
