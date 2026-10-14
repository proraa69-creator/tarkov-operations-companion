import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildScanResult, identityScanResult } from './eftLogTimeline'
import { tarkovEdition, useLogStatus } from './logStatus'

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

describe('the log status follows the main process from its first reader on', () => {
  it('«not found» once the search found nothing; the identity\'s mode as soon as it is published, also before sign-in', async () => {
    let publish: ((scan: unknown) => void) | undefined
    const autoFindAndScanLogs = vi.fn(async () => null)
    window.tarkovDesktop = { onLogsUpdated: (callback: (scan: unknown) => void) => { publish = callback; return () => {} }, autoFindAndScanLogs } as never
    try {
      sessionStorage.clear()
      // Any reader starts it (the locked app's screen reader as well as the unlocked app), only once per page.
      const first = renderHook(() => useLogStatus())
      renderHook(() => useLogStatus())
      expect(autoFindAndScanLogs).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(first.result.current.notFound).toBe(true))
      // The game starts later: the main process finds its logs and publishes the identity of the newest launches.
      const identity = identityScanResult(buildScanResult([{ kind: 'mode', at: 1, mode: 'pve' }, { kind: 'profile', at: 2, profileId: 'b'.repeat(24), accountId: 7 }], 1))
      act(() => publish!({ ...identity, folder: 'C:/Battlestate Games/EFT/Logs' }))
      expect(first.result.current).toMatchObject({ notFound: false, folder: 'C:/Battlestate Games/EFT/Logs', scan: { latestMode: 'pve', identityOnly: true } })
      expect(sessionStorage.getItem('eft-last-detected-mode')).toBe('pve')
    } finally {
      Reflect.deleteProperty(window, 'tarkovDesktop')
    }
  })
})
