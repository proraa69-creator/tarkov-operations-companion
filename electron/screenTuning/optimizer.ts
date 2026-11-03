import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodePowerShell, type PcInfo } from './pcInfo.js'

/**
 * «Оптимизация компьютера» (owner, 27.10.2026: «не усиливая ничего… не разгоняя, чтобы не навредить компьютеру
 * пользователя»; 03.11.2026: «обычная оптимизация и продвинутая… покажи человеку список то что можно оптимизировать…
 * галочки что оптимизировать и кнопка подтвердить или отменить… окно да нет»). A list of steps the player ticks, each
 * one undone by «Вернуть как было»:
 *   «Обычная» — what Windows itself offers for games, in the player's own settings (HKCU), at once: the «Высокая
 *     производительность» power plan (not on battery), «Игровой режим», no background recording of the game, Windows 11's
 *     optimisations for windowed games, the game on the stronger video card (two video cards);
 *   «Продвинутая» — besides those: Windows visual effects for performance (after signing in again) and, with
 *     administrator rights (Windows asks) and a restart, a page file Windows manages and hardware GPU scheduling.
 * Never: overclocking, voltages, BIOS, drivers, services, the game's process or files. What the app cannot do itself —
 * the video card's driver and its settings app, the memory's XMP profile, an SSD for the game — comes as tips; heavy
 * programs beside the game are only listed.
 */

export type Run = (file: string, args: string[], timeoutMs?: number) => Promise<string>

const systemFile = (name: string) => join(process.env.SystemRoot || 'C:\\Windows', 'System32', name)
export const POWERSHELL = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

export const defaultRun: Run = (file, args, timeoutMs = 10_000) => new Promise((resolve, reject) => {
  execFile(file, args, { windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(String(stdout)))
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

/** `reg query <key> /v <name>` → the text value ('' when empty), or null when the value is not there. */
export function parseRegString(output: string, name: string): string | null {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().toLowerCase().startsWith(name.toLowerCase()) && /\sREG_(?:EXPAND_)?SZ\b/.test(entry))
  const match = line ? /\sREG_(?:EXPAND_)?SZ\b(.*)$/.exec(line) : null
  return match ? match[1]!.trim() : null
}

interface RegistrySetting { key: string; name: string; want: number }
type RegistryId = 'gameMode' | 'gameDvr' | 'appCapture' | 'visualEffects'

/** Each DWORD step's registry value (all under the player's own HKCU). */
export const REGISTRY: Record<RegistryId, RegistrySetting> = {
  gameMode: { key: 'HKCU\\Software\\Microsoft\\GameBar', name: 'AutoGameModeEnabled', want: 1 },
  gameDvr: { key: 'HKCU\\System\\GameConfigStore', name: 'GameDVR_Enabled', want: 0 },
  appCapture: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'AppCaptureEnabled', want: 0 },
  // 2 = «Обеспечить наилучшее быстродействие» (System → Advanced → Performance).
  visualEffects: { key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects', name: 'VisualFXSetting', want: 2 },
}

/** Windows' per-game graphics settings: the global one (windowed games) and one value per game's exe (its video card). */
export const GPU_PREFERENCES = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences'
const WINDOWED_GAMES = 'DirectXUserGlobalSettings'
const HAGS = { key: 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', name: 'HwSchMode' }
/** «Оптимизации для оконных игр» came with Windows 11 22H2. */
const WINDOWED_GAMES_BUILD = 22621
/** Hardware GPU scheduling came with Windows 10 2004. */
const HAGS_BUILD = 19041

/** One setting of a «A=1;B=0;» DirectX value. */
export const directXSetting = (value: string | null, name: string) => (value ?? '').split(';').map((part) => part.split('=')).find(([key]) => key?.trim() === name)?.[1]?.trim()
/** The value with `name=want`, the other settings kept as they were. */
export function withDirectXSetting(value: string | null, name: string, want: string) {
  const others = (value ?? '').split(';').map((part) => part.trim()).filter((part) => part && part.split('=')[0]!.trim() !== name)
  return `${[...others, `${name}=${want}`].join(';')};`
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

export type OptimizeItemId = 'power' | 'gameMode' | 'recording' | 'windowedGames' | 'gameGpu' | 'visualEffects' | 'pageFile' | 'gpuScheduling'
export const OPTIMIZE_ITEM_IDS: readonly OptimizeItemId[] = ['power', 'gameMode', 'recording', 'windowedGames', 'gameGpu', 'visualEffects', 'pageFile', 'gpuScheduling']
/** Without a list of its own (an older window): the three steps of the first «Оптимизировать компьютер». */
export const FIRST_STEPS: readonly OptimizeItemId[] = ['power', 'gameMode', 'recording']

/** One line of the list: what it does, how it is now, whether it can be ticked here. */
export interface OptimizeItem {
  id: OptimizeItemId
  level: 'normal' | 'advanced'
  title: string
  why: string
  /** How it is set now, in words. */
  now: string
  /** Already as the step sets it. */
  done: boolean
  /** Possible on this computer now; `reason` says why not. */
  available: boolean
  reason?: string
  /** Ticked when the list opens. */
  recommended: boolean
  /** Windows asks for administrator rights. */
  admin?: true
  /** Works after a restart, or after signing in to Windows again. */
  after?: 'restart' | 'signIn'
}

/** Where a tip's button leads: the video card's app when it is installed, else its page (index.ts openTool). */
export type OptimizeOpenTarget = 'nvidia-app' | 'amd-software' | 'nvidia-driver' | 'amd-driver' | 'intel-driver'

/** What the app cannot do itself: the player does it, the tip says how. */
export interface OptimizeTip {
  id: 'noDriver' | 'oldDriver' | 'nvidiaApp' | 'amdSoftware' | 'ramSpeed' | 'ramSize' | 'gameDisk' | 'battery'
  title: string
  text: string
  steps?: string[]
  open?: OptimizeOpenTarget
  openLabel?: string
}

export interface OptimizeStatus {
  windows: boolean
  onBattery: boolean
  power: { guid: string; name: string; isHigh: boolean; highAvailable: boolean } | null
  gameMode: boolean | null
  backgroundRecording: boolean | null
  /** Hardware-accelerated GPU scheduling. */
  gpuScheduling: boolean | null
  heavy: Array<{ label: string; why: string; memoryMb: number }>
  /** What «Вернуть как было» would undo. */
  canRevert: boolean
  /** «Ваш компьютер»: null when Windows did not answer. */
  pc: PcInfo | null
  items: OptimizeItem[]
  tips: OptimizeTip[]
}

/** Values before the steps: null = the value was not there (deleted again on revert). */
export interface OptimizeBackup {
  powerGuid?: string
  registry?: Partial<Record<RegistryId, number | null>>
  /** Text values under GPU_PREFERENCES before the steps (`name`: the value's name). */
  text?: Partial<Record<'windowedGames' | 'gameGpu', { name: string; value: string | null }>>
  /** The page file as it was before «Файл подкачки — по выбору Windows». */
  pageFile?: { automatic: boolean; files: Array<{ path: string; initialMb: number; maxMb: number }> }
  /** HwSchMode before (null: none). */
  gpuScheduling?: number | null
}

/** Runs a PowerShell script with administrator rights (Windows asks); its `$result` back, null when refused or failed. */
export type Elevated = (script: string) => Promise<Record<string, unknown> | null>

export interface OptimizeContext {
  pc?: PcInfo | null
  elevated?: Elevated
}

/** The game's exe for its per-game graphics value: in the folder the launcher installed it to. */
export const gameExeOf = (pc: PcInfo | null | undefined) => (pc?.game ? `${pc.game.folder}\\EscapeFromTarkov.exe` : null)

interface Readings {
  active: { guid: string; name: string } | null
  plans: string[]
  registry: Record<RegistryId, number | null>
  windowedGames: string | null
  gameGpu: string | null
  hags: number | null
  tasks: Map<string, number>
}

async function regValue(run: Run, setting: { key: string; name: string }) {
  try { return parseRegDword(await run(systemFile('reg.exe'), ['query', setting.key, '/v', setting.name]), setting.name) } catch { return null }
}

async function regString(run: Run, key: string, name: string) {
  try { return parseRegString(await run(systemFile('reg.exe'), ['query', key, '/v', name]), name) } catch { return null }
}

async function readWindows(run: Run, gameExe: string | null, withTasks: boolean): Promise<Readings> {
  const [active, plans, gameMode, gameDvr, appCapture, visualEffects, windowedGames, gameGpu, hags, tasks] = await Promise.all([
    run(systemFile('powercfg.exe'), ['/getactivescheme']).then(parseActiveScheme).catch(() => null),
    run(systemFile('powercfg.exe'), ['/list']).then(parseSchemeList).catch(() => [] as string[]),
    regValue(run, REGISTRY.gameMode),
    regValue(run, REGISTRY.gameDvr),
    regValue(run, REGISTRY.appCapture),
    regValue(run, REGISTRY.visualEffects),
    regString(run, GPU_PREFERENCES, WINDOWED_GAMES),
    gameExe ? regString(run, GPU_PREFERENCES, gameExe) : Promise.resolve(null),
    regValue(run, HAGS),
    withTasks ? run(systemFile('tasklist.exe'), ['/FO', 'CSV', '/NH']).then(parseTaskList).catch(() => new Map<string, number>()) : Promise.resolve(new Map<string, number>()),
  ])
  return { active, plans, registry: { gameMode, gameDvr, appCapture, visualEffects }, windowedGames, gameGpu, hags, tasks }
}

/** A reason after «Шаг: »: its first letter lower case, the rest (Windows, NVIDIA) as written. */
const lowerFirst = (text: string | undefined) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : '')
const isHighPlan = (guid: string | undefined) => guid === POWER_PLANS.high || guid === POWER_PLANS.ultimate
const gb = (mb: number) => `${Math.round(mb / 1024)} ГБ`
/** Video cards that count for «Игра на мощной видеокарте» and the driver tips. */
const realGpus = (pc: PcInfo | null | undefined) => pc?.gpus ?? []
const discrete = (pc: PcInfo | null | undefined) => realGpus(pc).filter((gpu) => gpu.vendor === 'nvidia' || gpu.vendor === 'amd')

/** «Файл подкачки»: how it is now and whether the step has something to do. */
function pageFileState(pc: PcInfo | null | undefined): { now: string; done: boolean; available: boolean; reason?: string; recommended: boolean } {
  const page = pc?.pageFile
  if (!page) return { now: 'неизвестно', done: false, available: false, reason: 'Windows не сообщил настройки файла подкачки', recommended: false }
  if (page.automatic) return { now: 'размер выбирает Windows', done: true, available: true, recommended: false }
  if (!page.files.length) return { now: 'выключен', done: false, available: true, recommended: true }
  // A file whose size Windows picks (0 / 0) is as good as the automatic one.
  if (page.files.some((file) => file.maxMb === 0)) return { now: `${page.files.map((file) => file.path.slice(0, 2)).join(', ')} — размер выбирает Windows`, done: true, available: true, recommended: false }
  const largest = Math.max(...page.files.map((file) => file.maxMb))
  const now = page.files.map((file) => `${file.path.slice(0, 2)} ${gb(file.initialMb)}–${gb(file.maxMb)}`).join(', ')
  // EFT takes 10–14 GB: with 16 GB of memory or less a small page file means crashes.
  if (largest < 8192) return { now: `${now} — мало для EFT`, done: false, available: true, recommended: (pc?.ramGb ?? 16) <= 16 }
  return { now: `${now} — достаточно`, done: true, available: true, recommended: false }
}

export function optimizeItems(readings: Readings, pc: PcInfo | null | undefined, onBattery: boolean): OptimizeItem[] {
  const { active, plans } = readings
  const target = plans.includes(POWER_PLANS.high) ? POWER_PLANS.high : plans.includes(POWER_PLANS.ultimate) ? POWER_PLANS.ultimate : ''
  const powerDone = isHighPlan(active?.guid)
  const powerReason = onBattery ? 'Ноутбук работает от батареи' : !active ? 'Windows не ответил' : !powerDone && !target ? 'В этом Windows нет такой схемы' : undefined
  const recordingOn = !(readings.registry.gameDvr === 0 || readings.registry.appCapture === 0)
  const build = pc?.windows?.build ?? 0
  const windowedDone = directXSetting(readings.windowedGames, 'SwapEffectUpgradeEnable') === '1'
  const windowedReason = !pc?.windows ? 'Не удалось узнать версию Windows' : build < WINDOWED_GAMES_BUILD ? 'Есть только в Windows 11' : undefined
  const gameExe = gameExeOf(pc)
  const gameGpuDone = directXSetting(readings.gameGpu, 'GpuPreference') === '2'
  const gameGpuReason = realGpus(pc).length < 2 ? 'Одна видеокарта — выбирать не из чего' : !gameExe ? 'Не найдена папка игры' : undefined
  const page = pageFileState(pc)
  const hagsReason = build && build < HAGS_BUILD ? 'Нужен Windows 10 версии 2004 или новее' : !discrete(pc).length ? 'Нужна видеокарта NVIDIA или AMD' : undefined
  const item = (value: OptimizeItem) => value
  return [
    item({ id: 'power', level: 'normal', title: 'Схема питания «Высокая производительность»', why: 'Процессор и видеокарта не сбрасывают частоты посреди боя.', now: active ? POWER_PLAN_NAMES[active.guid] ?? 'своя схема' : 'неизвестно', done: powerDone, available: !powerReason, ...(powerReason ? { reason: powerReason } : {}), recommended: !powerDone && !powerReason }),
    item({ id: 'gameMode', level: 'normal', title: 'Игровой режим Windows', why: 'Windows отдаёт игре больше ресурсов и не ставит обновления во время игры.', now: readings.registry.gameMode === 0 ? 'выключен' : 'включён', done: readings.registry.gameMode !== 0, available: true, recommended: readings.registry.gameMode === 0 }),
    item({ id: 'recording', level: 'normal', title: 'Фоновая запись игры — выключить', why: 'Windows постоянно записывает последние минуты игры: это нагружает видеокарту и диск.', now: recordingOn ? 'включена' : 'выключена', done: !recordingOn, available: true, recommended: recordingOn }),
    item({ id: 'windowedGames', level: 'normal', title: 'Оптимизации для оконных игр', why: 'Игра в окне без рамки получает меньшую задержку, как в полноэкранном режиме.', now: windowedDone ? 'включены' : 'выключены', done: windowedDone, available: !windowedReason, ...(windowedReason ? { reason: windowedReason } : {}), recommended: !windowedDone && !windowedReason }),
    item({ id: 'gameGpu', level: 'normal', title: 'Игра на мощной видеокарте', why: 'На ноутбуках и ПК с двумя видеокартами Windows может запустить игру на встроенной.', now: gameGpuDone ? 'мощная видеокарта' : 'выбирает Windows', done: gameGpuDone, available: !gameGpuReason, ...(gameGpuReason ? { reason: gameGpuReason } : {}), recommended: !gameGpuDone && !gameGpuReason }),
    item({ id: 'visualEffects', level: 'advanced', title: 'Визуальные эффекты Windows — на быстродействие', why: 'Без анимаций и теней окон: чуть свободнее процессору и видеокарте. Windows станет проще на вид.', now: readings.registry.visualEffects === 2 ? 'на быстродействие' : 'как выбрал Windows', done: readings.registry.visualEffects === 2, available: true, recommended: false, after: 'signIn' }),
    item({ id: 'pageFile', level: 'advanced', title: 'Файл подкачки — размер выбирает Windows', why: 'EFT занимает много памяти: без файла подкачки или с маленьким игра вылетает и подтормаживает.', now: page.now, done: page.done, available: page.available, ...(page.reason ? { reason: page.reason } : {}), recommended: page.recommended && !page.done, admin: true, after: 'restart' }),
    item({ id: 'gpuScheduling', level: 'advanced', title: 'Аппаратное планирование GPU', why: 'Видеокарта сама распределяет свою работу. На одних компьютерах даёт пару кадров, на других без разницы.', now: readings.hags === 2 ? 'включено' : readings.hags === 1 ? 'выключено' : 'по умолчанию', done: readings.hags === 2, available: !hagsReason, ...(hagsReason ? { reason: hagsReason } : {}), recommended: false, admin: true, after: 'restart' }),
  ]
}

const DRIVER_OLD_DAYS = 120

export function optimizeTips(pc: PcInfo | null | undefined, onBattery: boolean, now = Date.now()): OptimizeTip[] {
  const tips: OptimizeTip[] = []
  if (onBattery) tips.push({ id: 'battery', title: 'Ноутбук работает от батареи', text: 'Подключите зарядку: от батареи процессор и видеокарта работают медленнее.' })
  if (!pc) return tips
  const missing = pc.gpus.find((gpu) => gpu.noDriver)
  if (missing) {
    tips.push({
      id: 'noDriver', title: 'Не установлен драйвер видеокарты',
      text: 'Windows работает с видеокартой через свой простой драйвер: игра будет тормозить. Установите драйвер с сайта производителя видеокарты.',
      open: missing.vendor === 'amd' ? 'amd-driver' : missing.vendor === 'intel' ? 'intel-driver' : 'nvidia-driver', openLabel: 'Скачать драйвер',
    })
  }
  for (const gpu of discrete(pc)) {
    const date = gpu.driverDate ? Date.parse(`${gpu.driverDate}T00:00:00Z`) : NaN
    if (gpu.noDriver || !Number.isFinite(date) || now - date < DRIVER_OLD_DAYS * 86_400_000) continue
    const day = gpu.driverDate!.split('-').reverse().join('.')
    tips.push({
      id: 'oldDriver', title: 'Драйвер видеокарты давно не обновлялся',
      text: `${gpu.name}: драйвер ${gpu.driver} от ${day}. Новые драйверы исправляют фризы и вылеты в играх — обновите его в ${gpu.vendor === 'nvidia' ? 'NVIDIA App' : 'AMD Software'}.`,
      open: gpu.vendor === 'nvidia' ? 'nvidia-app' : 'amd-software', openLabel: gpu.vendor === 'nvidia' ? 'Открыть NVIDIA App' : 'Открыть AMD Software',
    })
  }
  if (pc.gpus.some((gpu) => gpu.vendor === 'nvidia' && !gpu.noDriver)) {
    tips.push({
      id: 'nvidiaApp', title: 'Настройки NVIDIA для Escape from Tarkov',
      text: 'Их меняет только сам игрок. NVIDIA App → «Графика» → «Настройки программы» → EscapeFromTarkov.exe:',
      steps: ['Режим управления электропитанием — максимальная производительность', 'Режим низкой задержки — Вкл.', 'Вертикальный синхроимпульс — Выкл.', 'Размер кэша шейдеров — 10 ГБ', 'Фильтрация текстур — качество — высокая производительность'],
      open: 'nvidia-app', openLabel: 'Открыть NVIDIA App',
    })
  }
  if (pc.gpus.some((gpu) => gpu.vendor === 'amd' && !gpu.noDriver)) {
    tips.push({
      id: 'amdSoftware', title: 'Настройки AMD для Escape from Tarkov',
      text: 'Их меняет только сам игрок. AMD Software → «Игры» → Escape from Tarkov:',
      steps: ['Radeon Anti-Lag — Вкл.', 'Radeon Chill — Выкл.', 'Ждать вертикального обновления — Всегда выкл.', 'Качество фильтрации текстур — Производительность'],
      open: 'amd-software', openLabel: 'Открыть AMD Software',
    })
  }
  const memory = pc.ramMhz
  // A board that keeps memory at the processor's speed: XMP gives nothing there («Ваш компьютер» says so).
  if (memory && memory.running < memory.rated * 0.95 && !memory.locked) {
    tips.push({
      id: 'ramSpeed', title: 'Память работает медленнее, чем может',
      text: `Модули рассчитаны на ${memory.rated} МГц, а работают на ${memory.running} МГц. Включите профиль ${pc.cpu?.vendor === 'amd' ? 'EXPO (или DOCP)' : 'XMP'} в BIOS — в EFT это даёт заметную прибавку кадров. Приложение BIOS не меняет: это делается вручную при включении компьютера.`,
    })
  }
  if (pc.ramGb !== null && pc.ramGb < 16) {
    tips.push({ id: 'ramSize', title: 'Мало оперативной памяти', text: `${pc.ramGb} ГБ — меньше, чем нужно EFT (16 ГБ и больше). Закрывайте браузер и другие программы перед рейдом и не выключайте файл подкачки.` })
  }
  if (pc.game?.media === 'HDD') {
    tips.push({ id: 'gameDisk', title: 'Игра на жёстком диске (HDD)', text: 'С HDD игра дольше грузится и подгружает текстуры с фризами. Перенесите её на SSD.' })
  }
  return tips
}

export async function optimizeStatus(run: Run, onBattery: boolean, backup: OptimizeBackup | null, pc: PcInfo | null = null): Promise<OptimizeStatus> {
  const windows = process.platform === 'win32'
  if (!windows) return { windows, onBattery, power: null, gameMode: null, backgroundRecording: null, gpuScheduling: null, heavy: [], canRevert: false, pc: null, items: [], tips: [] }
  const readings = await readWindows(run, gameExeOf(pc), true)
  const heavy = new Map<string, { label: string; why: string; memoryMb: number }>()
  for (const program of HEAVY_PROGRAMS) {
    const memoryMb = readings.tasks.get(program.image.toLowerCase())
    if (!memoryMb) continue
    const known = heavy.get(program.label)
    heavy.set(program.label, { label: program.label, why: program.why, memoryMb: Math.round((known?.memoryMb ?? 0) + memoryMb) })
  }
  const { active, plans } = readings
  return {
    windows, onBattery,
    power: active ? { guid: active.guid, name: POWER_PLAN_NAMES[active.guid] ?? 'Своя схема', isHigh: isHighPlan(active.guid), highAvailable: plans.includes(POWER_PLANS.high) || plans.includes(POWER_PLANS.ultimate) } : null,
    // Game Mode is on when the value is missing (Windows 10 1903 and newer).
    gameMode: readings.registry.gameMode === null ? true : readings.registry.gameMode === 1,
    backgroundRecording: !(readings.registry.gameDvr === 0 || readings.registry.appCapture === 0),
    gpuScheduling: readings.hags === null ? null : readings.hags === 2,
    heavy: [...heavy.values()].sort((a, b) => b.memoryMb - a.memoryMb),
    canRevert: canRevert(backup),
    pc,
    items: optimizeItems(readings, pc, onBattery),
    tips: optimizeTips(pc, onBattery),
  }
}

const canRevert = (backup: OptimizeBackup | null) => Boolean(backup && (backup.powerGuid || Object.keys(backup.registry ?? {}).length || Object.keys(backup.text ?? {}).length || backup.pageFile || backup.gpuScheduling !== undefined))

/** A path or value inside single quotes in PowerShell. */
const quoted = (value: string) => `'${value.replace(/'/g, "''")}'`

/** The administrator part of the steps as one script (one question from Windows), each step's outcome in `$result`. */
export function elevatedApplyScript(steps: ReadonlyArray<'pageFile' | 'gpuScheduling'>) {
  const lines: string[] = []
  if (steps.includes('pageFile')) lines.push("try { $cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $true }; $result.pageFile = 'ok' } catch { $result.pageFile = [string]$_.Exception.Message }")
  if (steps.includes('gpuScheduling')) lines.push(`try { & reg.exe add ${quoted(HAGS.key)} /v ${HAGS.name} /t REG_DWORD /d 2 /f | Out-Null; if ($LASTEXITCODE -ne 0) { throw "reg $LASTEXITCODE" }; $result.gpuScheduling = 'ok' } catch { $result.gpuScheduling = [string]$_.Exception.Message }`)
  return lines.join('\n')
}

/** «Вернуть как было» for the administrator steps: the page file as it was, the GPU scheduling value before. */
export function elevatedRevertScript(backup: Pick<OptimizeBackup, 'pageFile' | 'gpuScheduling'>) {
  const lines: string[] = []
  if (backup.pageFile) {
    const files = backup.pageFile.files.map((file) => [
      `New-CimInstance -ClassName Win32_PageFileSetting -Property @{ Name = ${quoted(file.path)} } | Out-Null`,
      `Get-CimInstance Win32_PageFileSetting | Where-Object { $_.Name -eq ${quoted(file.path)} } | Set-CimInstance -Property @{ InitialSize = [uint32]${Math.round(file.initialMb)}; MaximumSize = [uint32]${Math.round(file.maxMb)} }`,
    ].join('; '))
    lines.push(`try { $cs = Get-CimInstance Win32_ComputerSystem; Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $${backup.pageFile.automatic ? 'true' : 'false'} }; ${backup.pageFile.automatic ? '' : `Get-CimInstance Win32_PageFileSetting | Remove-CimInstance; ${files.join('; ')}; `}$result.pageFile = 'ok' } catch { $result.pageFile = [string]$_.Exception.Message }`)
  }
  if (backup.gpuScheduling !== undefined) {
    const command = backup.gpuScheduling === null
      ? `& reg.exe delete ${quoted(HAGS.key)} /v ${HAGS.name} /f | Out-Null`
      : `& reg.exe add ${quoted(HAGS.key)} /v ${HAGS.name} /t REG_DWORD /d ${backup.gpuScheduling} /f | Out-Null`
    lines.push(`try { ${command}; $result.gpuScheduling = 'ok' } catch { $result.gpuScheduling = [string]$_.Exception.Message }`)
  }
  return lines.join('\n')
}

/**
 * The real administrator run: a second PowerShell started «as administrator» (Windows shows its question) writes `$result`
 * to a file of our own; the player's «Нет» there, a timeout or any error → null.
 */
export function elevatedRunner(run: Run, directory = tmpdir()): Elevated {
  return async (script) => {
    const out = join(directory, `raidos-optimize-${randomUUID()}.json`)
    const inner = `$ErrorActionPreference = 'Stop'\n$result = @{}\n${script}\n$result | ConvertTo-Json -Compress | Set-Content -LiteralPath ${quoted(out)} -Encoding UTF8`
    const outer = `try { Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encodePowerShell(inner)}') -ErrorAction Stop } catch { exit 3 }`
    try {
      await run(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(outer)], 180_000)
      const value: unknown = JSON.parse(readFileSync(out, 'utf8').replace(/^\uFEFF/, ''))
      return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    } catch {
      return null
    } finally {
      rmSync(out, { force: true })
    }
  }
}

export interface OptimizeResult {
  done: string[]
  skipped: string[]
  backup: OptimizeBackup
  /** A step that works only after a restart was made. */
  restart: boolean
}

/** Applies the ticked steps (`selection`); what was there before goes into the backup once, for «Вернуть как было». */
export async function optimize(run: Run, onBattery: boolean, previous: OptimizeBackup | null, selection: readonly OptimizeItemId[] = FIRST_STEPS, context: OptimizeContext = {}): Promise<OptimizeResult> {
  const done: string[] = [], skipped: string[] = []
  let restart = false
  // A second press keeps the values from before the first one.
  const backup: OptimizeBackup = { ...(previous ?? {}), registry: { ...(previous?.registry ?? {}) }, text: { ...(previous?.text ?? {}) } }
  const reg = systemFile('reg.exe'), powercfg = systemFile('powercfg.exe')
  const pick = new Set(selection)
  const pc = context.pc ?? null
  const gameExe = gameExeOf(pc)
  const readings = await readWindows(run, gameExe, false)
  const items = new Map(optimizeItems(readings, pc, onBattery).map((item) => [item.id, item]))

  if (pick.has('power')) {
    const { active, plans } = readings
    // «Высокая производительность» first; «Максимальная» only where Windows has no other.
    const target = plans.includes(POWER_PLANS.high) ? POWER_PLANS.high : plans.includes(POWER_PLANS.ultimate) ? POWER_PLANS.ultimate : ''
    if (onBattery) skipped.push('Схема питания: ноутбук работает от батареи — оставили как есть')
    else if (!active) skipped.push('Схема питания: Windows не ответил')
    else if (isHighPlan(active.guid)) done.push('Схема питания уже «Высокая производительность»')
    else if (!target) skipped.push('Схема питания: в этом Windows нет «Высокой производительности»')
    else {
      try {
        await run(powercfg, ['/setactive', target])
        backup.powerGuid ??= active.guid
        done.push('Схема питания: «Высокая производительность»')
      } catch { skipped.push('Схема питания: Windows не разрешил сменить') }
    }
  }

  const setDword = async (id: RegistryId) => {
    const setting = REGISTRY[id]
    const now = readings.registry[id]
    if (now === setting.want) return true
    try {
      await run(reg, ['add', setting.key, '/v', setting.name, '/t', 'REG_DWORD', '/d', String(setting.want), '/f'])
      if (!(id in backup.registry!)) backup.registry![id] = now
      return true
    } catch { return false }
  }
  if (pick.has('gameMode')) {
    if (await setDword('gameMode')) done.push('Игровой режим Windows включён')
    else skipped.push('Игровой режим Windows: не получилось')
  }
  if (pick.has('recording')) {
    const both = [await setDword('gameDvr'), await setDword('appCapture')]
    if (both.every(Boolean)) done.push('Фоновая запись игры выключена')
    else skipped.push('Фоновая запись игры: не получилось')
  }
  if (pick.has('visualEffects')) {
    if (await setDword('visualEffects')) done.push('Визуальные эффекты Windows — на быстродействие (полностью после повторного входа в Windows)')
    else skipped.push('Визуальные эффекты Windows: не получилось')
  }

  const setText = async (id: 'windowedGames' | 'gameGpu', name: string, before: string | null, value: string, label: string) => {
    try {
      await run(reg, ['add', GPU_PREFERENCES, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'])
      if (!backup.text![id]) backup.text![id] = { name, value: before }
      done.push(label)
    } catch { skipped.push(`${label}: не получилось`) }
  }
  if (pick.has('windowedGames')) {
    const item = items.get('windowedGames')!
    if (!item.available) skipped.push(`Оптимизации для оконных игр: ${lowerFirst(item.reason)}`)
    else if (item.done) done.push('Оптимизации для оконных игр уже включены')
    else await setText('windowedGames', WINDOWED_GAMES, readings.windowedGames, withDirectXSetting(readings.windowedGames, 'SwapEffectUpgradeEnable', '1'), 'Оптимизации для оконных игр включены')
  }
  if (pick.has('gameGpu')) {
    const item = items.get('gameGpu')!
    if (!item.available || !gameExe) skipped.push(`Игра на мощной видеокарте: ${lowerFirst(item.reason ?? 'Не найдена папка игры')}`)
    else if (item.done) done.push('Игра уже на мощной видеокарте')
    else await setText('gameGpu', gameExe, readings.gameGpu, withDirectXSetting(readings.gameGpu, 'GpuPreference', '2'), 'Игра запускается на мощной видеокарте')
  }

  // The administrator steps together: one question from Windows.
  const admin: Array<'pageFile' | 'gpuScheduling'> = []
  for (const id of ['pageFile', 'gpuScheduling'] as const) {
    if (!pick.has(id)) continue
    const item = items.get(id)!
    if (!item.available) skipped.push(`${item.title}: ${lowerFirst(item.reason)}`)
    else if (item.done) done.push(id === 'pageFile' ? 'Файл подкачки уже в порядке' : 'Аппаратное планирование GPU уже включено')
    else admin.push(id)
  }
  if (admin.length) {
    const result = context.elevated ? await context.elevated(elevatedApplyScript(admin)) : null
    if (!result) skipped.push('Windows не дал прав администратора: файл подкачки и планирование GPU не изменены')
    else {
      if (admin.includes('pageFile')) {
        if (result.pageFile === 'ok') {
          backup.pageFile ??= { automatic: pc?.pageFile?.automatic ?? false, files: pc?.pageFile?.files ?? [] }
          done.push('Файл подкачки: размер выбирает Windows (после перезагрузки)')
          restart = true
        } else skipped.push('Файл подкачки: Windows не дал изменить')
      }
      if (admin.includes('gpuScheduling')) {
        if (result.gpuScheduling === 'ok') {
          if (backup.gpuScheduling === undefined) backup.gpuScheduling = readings.hags
          done.push('Аппаратное планирование GPU включено (после перезагрузки)')
          restart = true
        } else skipped.push('Аппаратное планирование GPU: Windows не дал изменить')
      }
    }
  }
  if (!Object.keys(backup.text!).length) delete backup.text
  return { done, skipped, backup, restart }
}

export interface RevertResult {
  done: string[]
  /** What could not be put back (the administrator part when Windows was not allowed): kept for another try. */
  left: OptimizeBackup | null
  restart: boolean
}

/** Puts back what the steps changed. */
export async function revert(run: Run, backup: OptimizeBackup | null, context: Pick<OptimizeContext, 'elevated'> = {}): Promise<RevertResult> {
  const done: string[] = []
  if (!backup) return { done, left: null, restart: false }
  const reg = systemFile('reg.exe')
  if (backup.powerGuid) {
    try { await run(systemFile('powercfg.exe'), ['/setactive', backup.powerGuid]); done.push('Схема питания возвращена') } catch { /* kept */ }
  }
  for (const [id, value] of Object.entries(backup.registry ?? {}) as Array<[RegistryId, number | null]>) {
    const setting = REGISTRY[id]
    try {
      if (value === null) await run(reg, ['delete', setting.key, '/v', setting.name, '/f'])
      else await run(reg, ['add', setting.key, '/v', setting.name, '/t', 'REG_DWORD', '/d', String(value), '/f'])
      if (id === 'gameMode') done.push(setting.name)
    } catch { /* kept */ }
  }
  for (const saved of Object.values(backup.text ?? {})) {
    if (!saved) continue
    try {
      if (saved.value === null) await run(reg, ['delete', GPU_PREFERENCES, '/v', saved.name, '/f'])
      else await run(reg, ['add', GPU_PREFERENCES, '/v', saved.name, '/t', 'REG_SZ', '/d', saved.value, '/f'])
    } catch { /* kept */ }
  }
  const admin: Pick<OptimizeBackup, 'pageFile' | 'gpuScheduling'> = {
    ...(backup.pageFile ? { pageFile: backup.pageFile } : {}),
    ...(backup.gpuScheduling !== undefined ? { gpuScheduling: backup.gpuScheduling } : {}),
  }
  if (!Object.keys(admin).length) return { done, left: null, restart: false }
  const result = context.elevated ? await context.elevated(elevatedRevertScript(admin)) : null
  const left: OptimizeBackup = {}
  if (admin.pageFile) {
    if (result?.pageFile === 'ok') done.push('Файл подкачки возвращён (после перезагрузки)')
    else left.pageFile = admin.pageFile
  }
  if (admin.gpuScheduling !== undefined) {
    if (result?.gpuScheduling === 'ok') done.push('Аппаратное планирование GPU возвращено (после перезагрузки)')
    else left.gpuScheduling = admin.gpuScheduling
  }
  return { done, left: Object.keys(left).length ? left : null, restart: result !== null }
}
