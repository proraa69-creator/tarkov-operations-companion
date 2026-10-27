import { execFile } from 'node:child_process'
import { join } from 'node:path'

/**
 * «Оптимизировать компьютер» (owner, 27.10.2026: «не усиливая ничего… не разгоняя, чтобы не навредить компьютеру
 * пользователя»). Only what Windows itself offers for games, each step reversible with «Вернуть как было»:
 *   - the «Высокая производительность» power plan (not on battery), the plan before it is kept;
 *   - Windows «Игровой режим» on;
 *   - Xbox Game Bar background recording off (it records the last minutes of every game all the time).
 * Never: overclocking, voltages, the game's process or files, services, drivers or anything under HKLM. Heavy programs
 * running beside the game are only listed — the player closes them.
 */

export type Run = (file: string, args: string[]) => Promise<string>

const systemFile = (name: string) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)

export const defaultRun: Run = (file, args) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: 10_000, encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(String(stdout)))
})

export const POWER_PLANS = {
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  ultimate: 'e9a42b02-d5df-448d-aa00-03f14749eb61',
  saver: 'a1841308-3541-4fab-bc81-f71556f20b4a',
} as const

/** Our names for Windows' plans: powercfg prints its own in the console code page, which comes out garbled. */
export const POWER_PLAN_NAMES: Record<string, string> = {
  [POWER_PLANS.balanced]: 'Сбалансированная',
  [POWER_PLANS.high]: 'Высокая производительность',
  [POWER_PLANS.ultimate]: 'Максимальная производительность',
  [POWER_PLANS.saver]: 'Экономия энергии',
}

const GUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** `powercfg /getactivescheme` → the plan's id and its name as Windows shows it. */
export function parseActiveScheme(output: string): { guid: string; name: string } | null {
  const guid = GUID.exec(output)?.[1]?.toLowerCase()
  if (!guid) return null
  return { guid, name: /\(([^)]+)\)/.exec(output)?.[1]?.trim() ?? '' }
}

/** `powercfg /list` → every plan id present. */
export const parseSchemeList = (output: string) => [...output.matchAll(new RegExp(GUID.source, 'gi'))].map((match) => match[1]!.toLowerCase())

/** `reg query <key> /v <name>` → the DWORD value, or null when the value is not there. */
export function parseRegDword(output: string, name: string): number | null {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(name.toLowerCase()))
  const value = line && /REG_DWORD\s+0x([0-9a-f]+)/i.exec(line)?.[1]
  return value ? parseInt(value, 16) : null
}

interface RegistrySetting { key: string; name: string; want: number }

/** Each step's registry value (all under the player's own HKCU). */
export const REGISTRY: Record<'gameMode' | 'gameDvr' | 'appCapture', RegistrySetting> = {
  gameMode: { key: 'HKCU\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', want: 1 },
  gameDvr: { key: 'HKCU\\System\\GameConfigStore', name: 'GameDVR_Enabled', want: 0 },
  appCapture: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', want: 0 },
}

/**
 * Programs that take a lot beside the game (names as `tasklist` shows them). Matched case-insensitively; only listed,
 * never closed by the app.
 */
export const HEAVY_PROGRAMS: Array<{ image: string; label: string; why: string }> = [
  { image: 'chrome.exe', label: 'Google Chrome', why: 'много вкладок занимают память и процессор' },
  { image: 'msedge.exe', label: 'Microsoft Edge', why: 'много вкладок занимают память и процессор' },
  { image: 'firefox.exe', label: 'Firefox', why: 'много вкладок занимают память и процессор' },
  { image: 'browser.exe', label: 'Яндекс Браузер', why: 'много вкладок занимают память и процессор' },
  { image: 'opera.exe', label: 'Opera', why: 'много вкладок занимают память и процессор' },
  { image: 'obs64.exe', label: 'OBS Studio', why: 'запись и трансляция нагружают видеокарту' },
  { image: 'wallpaper64.exe', label: 'Wallpaper Engine', why: 'живые обои рисуются видеокартой' },
  { image: 'wallpaper32.exe', label: 'Wallpaper Engine', why: 'живые обои рисуются видеокартой' },
  { image: 'steamwebhelper.exe', label: 'Steam', why: 'окно Steam со страницами магазина' },
  { image: 'EpicGamesLauncher.exe', label: 'Epic Games Launcher', why: 'лаунчер обновляет игры в фоне' },
  { image: 'OneDrive.exe', label: 'OneDrive', why: 'синхронизация файлов нагружает диск' },
  { image: 'Teams.exe', label: 'Microsoft Teams', why: 'занимает много памяти' },
  { image: 'ms-teams.exe', label: 'Microsoft Teams', why: 'занимает много памяти' },
  { image: 'Spotify.exe', label: 'Spotify', why: 'занимает память' },
  { image: 'iCUE.exe', label: 'Corsair iCUE', why: 'подсветка нагружает процессор' },
  { image: 'qbittorrent.exe', label: 'qBittorrent', why: 'загрузки нагружают диск и сеть' },
  { image: 'uTorrent.exe', label: 'uTorrent', why: 'загрузки нагружают диск и сеть' },
]

/** `tasklist /FO CSV /NH` → memory per image name (MB, every copy of a program summed). */
export function parseTaskList(output: string): Map<string, number> {
  const memory = new Map<string, number>()
  for (const line of output.split(/\r?\n/)) {
    const cells = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1]!)
    if (cells.length < 5) continue
    const kb = Number(cells[4]!.replace(/[^\d]/g, ''))
    if (!Number.isFinite(kb)) continue
    const image = cells[0]!.toLowerCase()
    memory.set(image, (memory.get(image) ?? 0) + kb / 1024)
  }
  return memory
}

export interface OptimizeStatus {
  windows: boolean
  onBattery: boolean
  power: { guid: string; name: string; isHigh: boolean; highAvailable: boolean } | null
  gameMode: boolean | null
  backgroundRecording: boolean | null
  /** Hardware-accelerated GPU scheduling: shown only (it needs administrator rights and a restart). */
  gpuScheduling: boolean | null
  heavy: Array<{ label: string; why: string; memoryMb: number }>
  /** What «Вернуть как было» would undo. */
  canRevert: boolean
}

/** Values before «Оптимизировать»: null = the value was not there (deleted again on revert). */
export interface OptimizeBackup {
  powerGuid?: string
  registry?: Partial<Record<keyof typeof REGISTRY, number | null>>
}

async function regValue(run: Run, setting: RegistrySetting) {
  try { return parseRegDword(await run(systemFile('reg.exe'), ['query', setting.key, '/v', setting.name]), setting.name) } catch { return null }
}

export async function optimizeStatus(run: Run, onBattery: boolean, backup: OptimizeBackup | null): Promise<OptimizeStatus> {
  const windows = process.platform === 'win32'
  if (!windows) return { windows, onBattery, power: null, gameMode: null, backgroundRecording: null, gpuScheduling: null, heavy: [], canRevert: false }
  const [active, list, gameMode, gameDvr, appCapture, tasks, gpu] = await Promise.all([
    run(systemFile('powercfg.exe'), ['/getactivescheme']).then(parseActiveScheme).catch(() => null),
    run(systemFile('powercfg.exe'), ['/list']).then(parseSchemeList).catch(() => [] as string[]),
    regValue(run, REGISTRY.gameMode),
    regValue(run, REGISTRY.gameDvr),
    regValue(run, REGISTRY.appCapture),
    run(systemFile('tasklist.exe'), ['/FO', 'CSV', '/NH']).then(parseTaskList).catch(() => new Map<string, number>()),
    run(systemFile('reg.exe'), ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', '/v', 'HwSchMode']).then((output) => parseRegDword(output, 'HwSchMode')).catch(() => null),
  ])
  const heavy = new Map<string, { label: string; why: string; memoryMb: number }>()
  for (const program of HEAVY_PROGRAMS) {
    const memoryMb = tasks.get(program.image.toLowerCase())
    if (!memoryMb) continue
    const known = heavy.get(program.label)
    heavy.set(program.label, { label: program.label, why: program.why, memoryMb: Math.round((known?.memoryMb ?? 0) + memoryMb) })
  }
  const isHigh = active ? active.guid === POWER_PLANS.high || active.guid === POWER_PLANS.ultimate : false
  return {
    windows, onBattery,
    power: active ? { guid: active.guid, name: POWER_PLAN_NAMES[active.guid] ?? 'Своя схема', isHigh, highAvailable: list.includes(POWER_PLANS.high) || list.includes(POWER_PLANS.ultimate) } : null,
    // Game Mode is on when the value is missing (Windows 10 1903 and newer).
    gameMode: gameMode === null ? true : gameMode === 1,
    backgroundRecording: gameDvr === 0 || appCapture === 0 ? false : true,
    gpuScheduling: gpu === null ? null : gpu === 2,
    heavy: [...heavy.values()].sort((a, b) => b.memoryMb - a.memoryMb),
    canRevert: Boolean(backup && (backup.powerGuid || Object.keys(backup.registry ?? {}).length)),
  }
}

export interface OptimizeResult { done: string[]; skipped: string[]; backup: OptimizeBackup }

export async function optimize(run: Run, onBattery: boolean, previous: OptimizeBackup | null): Promise<OptimizeResult> {
  const done: string[] = [], skipped: string[] = []
  // A second press keeps the values from before the first one.
  const backup: OptimizeBackup = { ...(previous ?? {}), registry: { ...(previous?.registry ?? {}) } }
  const reg = systemFile('reg.exe'), powercfg = systemFile('powercfg.exe')

  const active = await run(powercfg, ['/getactivescheme']).then(parseActiveScheme).catch(() => null)
  const plans = await run(powercfg, ['/list']).then(parseSchemeList).catch(() => [] as string[])
  // «Высокая производительность» first; «Максимальная» only where Windows has no other.
  const target = plans.includes(POWER_PLANS.high) ? POWER_PLANS.high : plans.includes(POWER_PLANS.ultimate) ? POWER_PLANS.ultimate : ''
  if (onBattery) skipped.push('Схема питания: ноутбук работает от батареи — оставили как есть')
  else if (!active) skipped.push('Схема питания: Windows не ответил')
  else if (active.guid === target || active.guid === POWER_PLANS.high || active.guid === POWER_PLANS.ultimate) done.push('Схема питания уже «Высокая производительность»')
  else if (!target) skipped.push('Схема питания: в этом Windows нет «Высокой производительности»')
  else {
    try {
      await run(powercfg, ['/setactive', target])
      backup.powerGuid ??= active.guid
      done.push('Схема питания: «Высокая производительность»')
    } catch { skipped.push('Схема питания: Windows не разрешил сменить') }
  }

  const steps: Array<{ id: keyof typeof REGISTRY; label: string }> = [
    { id: 'gameMode', label: 'Игровой режим Windows включён' },
    { id: 'gameDvr', label: 'Фоновая запись Xbox Game Bar выключена' },
    { id: 'appCapture', label: 'Запись клипов Xbox Game Bar выключена' },
  ]
  for (const { id, label } of steps) {
    const setting = REGISTRY[id]
    const now = await regValue(run, setting)
    if (now === setting.want) { done.push(label); continue }
    try {
      await run(reg, ['add', setting.key, '/v', setting.name, '/t', 'REG_DWORD', '/d', String(setting.want), '/f'])
      if (!(id in backup.registry!)) backup.registry![id] = now
      done.push(label)
    } catch { skipped.push(`${label}: не получилось`) }
  }
  return { done, skipped, backup }
}

/** Puts back what «Оптимизировать» changed. */
export async function revert(run: Run, backup: OptimizeBackup | null): Promise<string[]> {
  const done: string[] = []
  if (!backup) return done
  const reg = systemFile('reg.exe')
  if (backup.powerGuid) {
    try { await run(systemFile('powercfg.exe'), ['/setactive', backup.powerGuid]); done.push('Схема питания возвращена') } catch { /* kept */ }
  }
  for (const [id, value] of Object.entries(backup.registry ?? {}) as Array<[keyof typeof REGISTRY, number | null]>) {
    const setting = REGISTRY[id]
    try {
      if (value === null) await run(reg, ['delete', setting.key, '/v', setting.name, '/f'])
      else await run(reg, ['add', setting.key, '/v', setting.name, '/t', 'REG_DWORD', '/d', String(value), '/f'])
      done.push(setting.name)
    } catch { /* kept */ }
  }
  return done
}
