// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { LogFolderGrants, mayWatchLogFolder, sameFolder } from './logFolders'

const GAME_LOGS = 'C:\\Battlestate Games\\Escape from Tarkov\\Logs'

describe('log folders the page may watch (L5)', () => {
  it('compares Windows folders case-insensitively, ignoring a trailing slash', () => {
    expect(sameFolder(GAME_LOGS, 'c:\\battlestate games\\escape from tarkov\\logs\\', true)).toBe(true)
    expect(sameFolder(GAME_LOGS, 'C:\\Users\\me\\Documents', true)).toBe(false)
    expect(sameFolder('/a/Logs', '/a/logs', false)).toBe(false)
    expect(sameFolder('', '', true)).toBe(false)
  })

  it('accepts a folder granted in this session', async () => {
    const grants = new LogFolderGrants(true)
    grants.grant(GAME_LOGS)
    const discover = vi.fn(async () => undefined)
    expect(await mayWatchLogFolder(GAME_LOGS.toUpperCase(), { grants, remembered: async () => '', discover, windows: true })).toBe(true)
    expect(discover).not.toHaveBeenCalled()
  })

  it('accepts the discovered Logs folder or the one picked in the dialog earlier, and nothing else', async () => {
    const grants = new LogFolderGrants(true)
    const options = { grants, remembered: async () => 'D:\\Games\\EFT\\Logs', discover: async () => GAME_LOGS, windows: true }
    expect(await mayWatchLogFolder(GAME_LOGS, options)).toBe(true)
    expect(await mayWatchLogFolder('D:\\Games\\EFT\\Logs', options)).toBe(true)
    expect(await mayWatchLogFolder('C:\\Users\\me\\AppData\\Roaming\\Tarkov Operator', options)).toBe(false)
    expect(await mayWatchLogFolder('\\\\attacker\\share', options)).toBe(false)
    expect(await mayWatchLogFolder(42, options)).toBe(false)
    expect(await mayWatchLogFolder('', options)).toBe(false)
  })

  it('refuses everything when discovery fails and nothing was picked', async () => {
    const grants = new LogFolderGrants(true)
    expect(await mayWatchLogFolder(GAME_LOGS, { grants, remembered: async () => { throw new Error('none') }, discover: async () => { throw new Error('none') }, windows: true })).toBe(false)
  })
})
