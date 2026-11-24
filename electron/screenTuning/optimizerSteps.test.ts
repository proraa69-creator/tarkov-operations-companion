import { describe, expect, it } from 'vitest'
import { elevatedApplyScript, elevatedRevertScript, GPU_PREFERENCES, optimize, optimizeItems, optimizeTips, parseRegString, POWER_PLANS, revert, withDirectXSetting, directXSetting, type Elevated, type Run } from './optimizer'
import type { PcInfo } from './pcInfo'

/** The owner's PC (03.11.2026): one NVIDIA card, Windows 10, memory held back by an H410 board, a big page file on D:. */
const OWNER_PC: PcInfo = {
  cpu: { name: 'Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz', vendor: 'intel', cores: 6, threads: 12 },
  gpus: [{ name: 'NVIDIA GeForce RTX 3060 Ti', vendor: 'nvidia', driver: '617.14', driverDate: '2026-09-17' }],
  ramGb: 16,
  ramMhz: { rated: 3200, running: 2667, locked: true },
  board: 'GALAX H410M',
  windows: { name: 'Windows 10 Pro', build: 19045 },
  laptop: false,
  pageFile: { automatic: false, files: [{ path: 'D:\\pagefile.sys', initialMb: 32768, maxMb: 49152 }], allocatedMb: 32768 },
  game: { folder: 'C:\\Battlestate Games\\Escape from Tarkov', drive: 'C', media: 'SSD' },
}

/** A Windows 11 laptop with two video cards, no page file and slow memory on a board that allows XMP. */
const LAPTOP: PcInfo = {
  ...OWNER_PC,
  gpus: [{ name: 'Intel(R) UHD Graphics', vendor: 'intel', driver: '31.0.101.4502', driverDate: '2026-06-01' }, { name: 'NVIDIA GeForce RTX 4060 Laptop GPU', vendor: 'nvidia', driver: '552.22', driverDate: '2026-01-10' }],
  ramGb: 16,
  ramMhz: { rated: 3200, running: 2400 },
  board: 'LENOVO LNVNB161216',
  windows: { name: 'Windows 11 Home', build: 22631 },
  laptop: true,
  pageFile: { automatic: false, files: [], allocatedMb: 0 },
}

/** A fake Windows with DWORD and text values; every call is recorded. */
function fakeWindows() {
  const state = { power: POWER_PLANS.balanced as string, values: new Map<string, { type: string; data: string }>() }
  const calls: string[] = []
  const run: Run = async (file, args) => {
    calls.push([file.split(/[\\/]/).pop(), ...args].join(' '))
    if (file.endsWith('powercfg.exe')) {
      if (args[0] === '/getactivescheme') return `GUID схемы питания: ${state.power}  (Схема)`
      if (args[0] === '/list') return `GUID схемы питания: ${POWER_PLANS.balanced}\nGUID схемы питания: ${POWER_PLANS.high}`
      if (args[0] === '/setactive') { state.power = args[1]!; return '' }
    }
    if (file.endsWith('reg.exe')) {
      const key = `${args[1]}|${args[3]}`
      if (args[0] === 'query') {
        const value = state.values.get(key)
        if (!value) throw new Error('not found')
        return `\n${args[1]}\n    ${args[3]}    ${value.type}    ${value.type === 'REG_DWORD' ? `0x${Number(value.data).toString(16)}` : value.data}\n`
      }
      if (args[0] === 'add') { state.values.set(key, { type: args[5]!, data: args[7]! }); return '' }
      if (args[0] === 'delete') { state.values.delete(key); return '' }
    }
    throw new Error(`unexpected ${file}`)
  }
  return { state, calls, run }
}

/** Windows' administrator question: `answer` 'yes' runs the script (recorded), 'no' is the player's «Нет». */
function fakeElevated(answer: 'yes' | 'no') {
  const scripts: string[] = []
  const elevated: Elevated = async (script) => {
    scripts.push(script)
    if (answer === 'no') return null
    return Object.fromEntries([...script.matchAll(/\$result\.(\w+) = 'ok'/g)].map((match) => [match[1], 'ok']))
  }
  return { scripts, elevated }
}

const readings = (patch: Partial<Parameters<typeof optimizeItems>[0]> = {}) => ({
  active: { guid: POWER_PLANS.balanced as string, name: '' }, plans: [POWER_PLANS.balanced, POWER_PLANS.high] as string[],
  registry: { gameMode: null, gameDvr: null, appCapture: null, visualEffects: null }, windowedGames: null, gameGpu: null, hags: null, tasks: new Map<string, number>(), ...patch,
})

describe('«Обычная» / «Продвинутая»: the steps a PC is offered', () => {
  it('reads text values and keeps the other DirectX settings', () => {
    expect(parseRegString('    DirectXUserGlobalSettings    REG_SZ    VRROptimizeEnable=0;', 'DirectXUserGlobalSettings')).toBe('VRROptimizeEnable=0;')
    expect(parseRegString('    C:\\Games\\EFT.exe    REG_SZ    GpuPreference=2;', 'C:\\Games\\EFT.exe')).toBe('GpuPreference=2;')
    expect(parseRegString('nothing', 'x')).toBeNull()
    expect(withDirectXSetting('VRROptimizeEnable=0;SwapEffectUpgradeEnable=0;', 'SwapEffectUpgradeEnable', '1')).toBe('VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;')
    expect(withDirectXSetting(null, 'GpuPreference', '2')).toBe('GpuPreference=2;')
    expect(directXSetting('VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;', 'SwapEffectUpgradeEnable')).toBe('1')
  })

  it('the owner\'s PC: the three Windows steps ticked; Windows 11, two cards and a page file not needed; GPU scheduling optional', () => {
    const items = new Map(optimizeItems(readings(), OWNER_PC, false).map((item) => [item.id, item]))
    expect([...items.values()].filter((item) => item.recommended).map((item) => item.id)).toEqual(['power', 'recording'])
    expect(items.get('gameMode')).toMatchObject({ done: true, now: 'включён' })
    expect(items.get('windowedGames')).toMatchObject({ available: false, reason: 'Есть только в Windows 11' })
    expect(items.get('gameGpu')).toMatchObject({ available: false, reason: 'Одна видеокарта — выбирать не из чего' })
    expect(items.get('pageFile')).toMatchObject({ level: 'advanced', done: true, now: 'D: 32 ГБ–48 ГБ — достаточно', admin: true, after: 'restart' })
    expect(items.get('gpuScheduling')).toMatchObject({ level: 'advanced', available: true, recommended: false, admin: true })
    expect(items.get('visualEffects')).toMatchObject({ level: 'advanced', recommended: false, after: 'signIn' })
    expect([...items.values()].filter((item) => item.level === 'normal').map((item) => item.id)).toEqual(['power', 'gameMode', 'recording', 'windowedGames', 'gameGpu'])
  })

  it('a Windows 11 laptop with two cards and no page file: those steps are offered and ticked; on battery the power plan is not', () => {
    const items = new Map(optimizeItems(readings(), LAPTOP, true).map((item) => [item.id, item]))
    expect(items.get('windowedGames')).toMatchObject({ available: true, recommended: true })
    expect(items.get('gameGpu')).toMatchObject({ available: true, recommended: true })
    expect(items.get('pageFile')).toMatchObject({ now: 'выключен', recommended: true })
    expect(items.get('power')).toMatchObject({ available: false, reason: 'Ноутбук работает от батареи', recommended: false })
  })

  it('tips: NVIDIA settings for the owner, no XMP tip on a board that cannot; an old driver, XMP, the battery for the laptop', () => {
    const now = Date.parse('2026-11-03T12:00:00Z')
    expect(optimizeTips(OWNER_PC, false, now).map((tip) => tip.id)).toEqual(['nvidiaApp'])
    const laptop = optimizeTips(LAPTOP, true, now)
    expect(laptop.map((tip) => tip.id)).toEqual(['battery', 'oldDriver', 'nvidiaApp', 'ramSpeed'])
    expect(laptop.find((tip) => tip.id === 'oldDriver')).toMatchObject({ open: 'nvidia-app', text: expect.stringContaining('552.22 от 10.01.2026') })
    expect(laptop.find((tip) => tip.id === 'ramSpeed')?.text).toContain('3200 МГц, а работают на 2400 МГц')
    const missing = optimizeTips({ ...OWNER_PC, gpus: [{ name: 'Microsoft Basic Display Adapter', vendor: 'amd', driver: '10.0', noDriver: true }] }, false, now)
    expect(missing[0]).toMatchObject({ id: 'noDriver', open: 'amd-driver' })
    expect(optimizeTips(null, false, now)).toEqual([])
  })
})

describe('applying and putting back', () => {
  it('only the ticked steps; text values keep the other settings and come back as they were', async () => {
    const windows = fakeWindows()
    windows.state.values.set(`${GPU_PREFERENCES}|DirectXUserGlobalSettings`, { type: 'REG_SZ', data: 'VRROptimizeEnable=0;' })
    const result = await optimize(windows.run, false, null, ['windowedGames', 'gameGpu', 'visualEffects'], { pc: LAPTOP })
    expect(windows.state.power).toBe(POWER_PLANS.balanced)
    expect(windows.state.values.get(`${GPU_PREFERENCES}|DirectXUserGlobalSettings`)?.data).toBe('VRROptimizeEnable=0;SwapEffectUpgradeEnable=1;')
    expect(windows.state.values.get(`${GPU_PREFERENCES}|C:\\Battlestate Games\\Escape from Tarkov\\EscapeFromTarkov.exe`)?.data).toBe('GpuPreference=2;')
    expect(result.done).toEqual(['Визуальные эффекты Windows — на быстродействие (полностью после повторного входа в Windows)', 'Оптимизации для оконных игр включены', 'Игра запускается на мощной видеокарте'])
    expect(result.restart).toBe(false)
    expect(windows.calls.filter((call) => call.startsWith('reg.exe add')).every((call) => call.includes('HKCU\\'))).toBe(true)

    const back = await revert(windows.run, result.backup)
    expect(back.left).toBeNull()
    expect(windows.state.values.get(`${GPU_PREFERENCES}|DirectXUserGlobalSettings`)?.data).toBe('VRROptimizeEnable=0;')
    expect(windows.state.values.has(`${GPU_PREFERENCES}|C:\\Battlestate Games\\Escape from Tarkov\\EscapeFromTarkov.exe`)).toBe(false)
    expect(windows.state.values.has('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects|VisualFXSetting')).toBe(false)
  })

  it('a step this PC does not have is skipped with its reason; nothing is written for it', async () => {
    const windows = fakeWindows()
    const result = await optimize(windows.run, false, null, ['windowedGames', 'gameGpu'], { pc: OWNER_PC })
    expect(result.skipped).toEqual(['Оптимизации для оконных игр: есть только в Windows 11', 'Игра на мощной видеокарте: одна видеокарта — выбирать не из чего'])
    expect(windows.calls.some((call) => call.startsWith('reg.exe add'))).toBe(false)
  })

  it('administrator steps: one question from Windows for both; the page file and the scheduling value before are kept and put back', async () => {
    const windows = fakeWindows()
    const yes = fakeElevated('yes')
    const result = await optimize(windows.run, false, null, ['pageFile', 'gpuScheduling'], { pc: LAPTOP, elevated: yes.elevated })
    expect(yes.scripts).toHaveLength(1)
    expect(yes.scripts[0]).toContain('AutomaticManagedPagefile = $true')
    expect(yes.scripts[0]).toContain("/v HwSchMode /t REG_DWORD /d 2 /f")
    expect(result.backup).toMatchObject({ pageFile: { automatic: false, files: [] }, gpuScheduling: null })
    expect(result.restart).toBe(true)
    expect(result.done).toEqual(['Файл подкачки: размер выбирает Windows (после перезагрузки)', 'Аппаратное планирование GPU включено (после перезагрузки)'])

    const back = await revert(windows.run, result.backup, { elevated: yes.elevated })
    expect(yes.scripts[1]).toContain('AutomaticManagedPagefile = $false')
    expect(yes.scripts[1]).toContain("& reg.exe delete 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' /v HwSchMode /f")
    expect(back).toMatchObject({ left: null, restart: true })
  })

  it('«Нет» in Windows\' question: nothing changes, the step says so; a refused revert keeps its part for another try', async () => {
    const windows = fakeWindows()
    const no = fakeElevated('no')
    const refused = await optimize(windows.run, false, null, ['pageFile'], { pc: LAPTOP, elevated: no.elevated })
    expect(refused.skipped).toEqual(['Windows не дал прав администратора: файл подкачки и планирование GPU не изменены'])
    expect(refused.backup.pageFile).toBeUndefined()
    const left = await revert(windows.run, { pageFile: { automatic: false, files: [{ path: 'D:\\pagefile.sys', initialMb: 32768, maxMb: 49152 }] } }, { elevated: no.elevated })
    expect(left.left).toEqual({ pageFile: { automatic: false, files: [{ path: 'D:\\pagefile.sys', initialMb: 32768, maxMb: 49152 }] } })
  })

  it('the revert script puts a fixed page file back with its sizes', () => {
    const script = elevatedRevertScript({ pageFile: { automatic: false, files: [{ path: "D:\\it's.sys", initialMb: 32768, maxMb: 49152 }] }, gpuScheduling: 1 })
    expect(script).toContain("Name = 'D:\\it''s.sys'")
    expect(script).toContain('InitialSize = [uint32]32768; MaximumSize = [uint32]49152')
    expect(script).toContain('/v HwSchMode /t REG_DWORD /d 1 /f')
    expect(elevatedApplyScript([])).toBe('')
  })
})
