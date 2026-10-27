import { describe, expect, it } from 'vitest'
import { optimize, optimizeStatus, parseActiveScheme, parseRegDword, parseSchemeList, parseTaskList, POWER_PLANS, revert, type Run } from './optimizer'

const ACTIVE_BALANCED = `GUID схемы питания: ${POWER_PLANS.balanced}  (Сбалансированная)`
const LIST = `${ACTIVE_BALANCED} *\nGUID схемы питания: ${POWER_PLANS.high}  (Высокая производительность)\nGUID схемы питания: ${POWER_PLANS.saver}  (Экономия энергии)`

/** A fake Windows: powercfg and reg answer from `state`, every call is recorded. */
function fakeWindows(registry: Record<string, number | undefined> = {}) {
  const state = { power: POWER_PLANS.balanced as string, registry: { ...registry } }
  const calls: string[] = []
  const run: Run = async (file, args) => {
    calls.push([file.split('\\').pop(), ...args].join(' '))
    if (file.endsWith('powercfg.exe')) {
      if (args[0] === '/getactivescheme') return `GUID схемы питания: ${state.power}  (Схема)`
      if (args[0] === '/list') return LIST
      if (args[0] === '/setactive') { state.power = args[1]!; return '' }
    }
    if (file.endsWith('reg.exe')) {
      const name = args[3]!
      if (args[0] === 'query') {
        if (state.registry[name] === undefined) throw new Error('not found')
        return `\n${args[1]}\n    ${name}    REG_DWORD    0x${state.registry[name]!.toString(16)}\n`
      }
      if (args[0] === 'add') { state.registry[name] = Number(args[7]); return '' }
      if (args[0] === 'delete') { delete state.registry[name]; return '' }
    }
    if (file.endsWith('tasklist.exe')) return '"chrome.exe","1","Console","1","512 000 K"\n"chrome.exe","2","Console","1","256 000 K"\n"explorer.exe","3","Console","1","90 000 K"'
    throw new Error(`unexpected ${file}`)
  }
  return { state, calls, run }
}

describe('«Оптимизировать компьютер»: reading Windows', () => {
  it('reads the power plan, the plans present, a registry value and the process list', () => {
    expect(parseActiveScheme(ACTIVE_BALANCED)).toEqual({ guid: POWER_PLANS.balanced, name: 'Сбалансированная' })
    expect(parseSchemeList(LIST)).toEqual([POWER_PLANS.balanced, POWER_PLANS.high, POWER_PLANS.saver])
    expect(parseRegDword('    AutoGameModeEnabled    REG_DWORD    0x1', 'AutoGameModeEnabled')).toBe(1)
    expect(parseRegDword('nothing', 'AutoGameModeEnabled')).toBeNull()
    expect(Math.round(parseTaskList('"chrome.exe","1","Console","1","512 000 K"\n"chrome.exe","2","Console","1","256 000 K"').get('chrome.exe')!)).toBe(750)
  })
})

describe.runIf(process.platform === 'win32')('«Оптимизировать компьютер» on Windows', () => {
  it('turns the steps on, keeps what was before and puts it back', async () => {
    const windows = fakeWindows({ GameDVR_Enabled: 1 })
    const result = await optimize(windows.run, false, null)
    expect(windows.state.power).toBe(POWER_PLANS.high)
    expect(windows.state.registry).toEqual({ GameDVR_Enabled: 0, AutoGameModeEnabled: 1, AppCaptureEnabled: 0 })
    expect(result.backup).toEqual({ powerGuid: POWER_PLANS.balanced, registry: { gameMode: null, gameDvr: 1, appCapture: null } })
    expect(result.skipped).toEqual([])

    // A second press keeps the values from before the first one.
    const again = await optimize(windows.run, false, result.backup)
    expect(again.backup).toEqual(result.backup)

    await revert(windows.run, again.backup)
    expect(windows.state.power).toBe(POWER_PLANS.balanced)
    expect(windows.state.registry).toEqual({ GameDVR_Enabled: 1 })
  })

  it('leaves the power plan alone on battery and never touches anything but powercfg, reg and HKCU', async () => {
    const windows = fakeWindows()
    const result = await optimize(windows.run, true, null)
    expect(windows.state.power).toBe(POWER_PLANS.balanced)
    expect(result.skipped[0]).toMatch(/батареи/)
    expect(windows.calls.filter((call) => call.startsWith('reg.exe add')).every((call) => call.includes('HKCU\\'))).toBe(true)
  })

  it('lists heavy programs with their memory, summed', async () => {
    const status = await optimizeStatus(fakeWindows().run, false, null)
    expect(status.heavy).toEqual([{ label: 'Google Chrome', why: expect.any(String), memoryMb: 750 }])
    expect(status.power).toMatchObject({ name: 'Сбалансированная', isHigh: false, highAvailable: true })
    expect(status.gameMode).toBe(true)
    expect(status.canRevert).toBe(false)
  })
})
