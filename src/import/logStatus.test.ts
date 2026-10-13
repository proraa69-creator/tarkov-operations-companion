import { describe, expect, it } from 'vitest'
import { tarkovEdition } from './logStatus'

describe('tarkovEdition: Steam or the BSG launcher, from the Logs folder', () => {
  it('a folder under steamapps is the Steam build, in any library and letters', () => {
    expect(tarkovEdition('D:\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\build\\Logs')).toBe('steam')
    expect(tarkovEdition('C:\\Program Files (x86)\\Steam\\SteamApps\\common\\Escape from Tarkov\\Logs')).toBe('steam')
    expect(tarkovEdition('E:/Игры/Steam/steamapps/common/Escape from Tarkov/build/Logs')).toBe('steam')
  })

  it('any other folder is the launcher\'s game', () => {
    expect(tarkovEdition('C:\\Battlestate Games\\EFT\\Logs')).toBe('launcher')
    expect(tarkovEdition('D:\\Games\\Escape from Tarkov\\Logs')).toBe('launcher')
  })

  it('no folder: «not found» only when the search found none, else unknown yet', () => {
    expect(tarkovEdition(undefined, true)).toBe('not-found')
    expect(tarkovEdition(null)).toBeNull()
  })
})
