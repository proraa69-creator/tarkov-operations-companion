import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildScanResult, identityScanResult } from './eftLogTimeline'
import { logWatchLine, tarkovEdition, useLogStatus } from './logStatus'

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

describe('the constant log tracking line (owner, 15.10.2026)', () => {
  const scan = { summaryByMode: { pvp: { lastActivityAt: '2026-10-15T10:05:00.000Z' }, pve: { lastActivityAt: '2026-10-15T11:42:00.000Z' }, seasonal: {} } } as unknown as import('./eftLogTimeline').ModeLogScanResult
  const time = (ms: number) => new Date(ms).toISOString().slice(11, 16)
  it('says the logs are tracked and when the game last logged anything, RU and EN', () => {
    expect(logWatchLine({ folder: 'L', scan, watch: { folder: 'L', mode: 'watch' } }, 'ru', time)).toBe('Журналы: отслеживаются · последнее событие 11:42')
    expect(logWatchLine({ folder: 'L', scan, watch: { folder: 'L', mode: 'poll' } }, 'en', time)).toBe('Logs: tracked · last event 11:42')
    expect(logWatchLine({ folder: 'L', watch: { folder: 'L', mode: 'watch', changedAt: Date.parse('2026-10-15T09:00:00Z') } }, 'ru', time)).toBe('Журналы: отслеживаются · последнее событие 09:00')
    expect(logWatchLine({ folder: 'L' }, 'ru', time)).toBe('Журналы: отслеживаются')
  })
  it('nothing followed: nothing, or «не найдены» once the search found no folder', () => {
    expect(logWatchLine({}, 'ru')).toBeNull()
    expect(logWatchLine({ watch: { folder: '', mode: 'none' } }, 'en')).toBeNull()
    expect(logWatchLine({ notFound: true, watch: { folder: '', mode: 'none' } }, 'ru')).toBe('Журналы: не найдены')
  })
})
