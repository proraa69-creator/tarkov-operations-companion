/**
 * «Ваш компьютер» on «Оптимизация компьютера» (owner, 03.11.2026: «определяй какой процессор стоит, проверяй есть ли
 * драйвера итд»): the processor, the video cards with their drivers, the memory and its speed, Windows, the page file and
 * the disk the game is on — read once with one PowerShell call, nothing is changed. The optimizer's steps and tips
 * (optimizer.ts) are chosen from it.
 */

export interface PcInfo {
  cpu: { name: string; vendor: 'intel' | 'amd' | 'other'; cores: number; threads: number } | null
  /** Real video cards only: virtual displays (Parsec, a virtual monitor driver…) are left out. */
  gpus: Array<{ name: string; vendor: 'nvidia' | 'amd' | 'intel' | 'other'; driver: string; driverDate?: string; noDriver?: true }>
  ramGb: number | null
  /**
   * The memory's rated and running speed, MHz (the slowest module). `locked`: an Intel board that runs memory only as fast
   * as the processor allows (H410, B460, H470, H510, H610) — no XMP there, the lower speed is normal.
   */
  ramMhz: { rated: number; running: number; locked?: true } | null
  /** The motherboard as Windows names it. */
  board: string | null
  windows: { name: string; build: number } | null
  laptop: boolean
  pageFile: { automatic: boolean; files: Array<{ path: string; initialMb: number; maxMb: number }>; allocatedMb: number } | null
  /** Escape from Tarkov's folder (the launcher's registry entry) and the kind of disk it is on. */
  game: { folder: string; drive: string; media: 'SSD' | 'HDD' | 'unknown' } | null
}

/** One PowerShell call; UTF-8 out, every part on its own so one failing query leaves the rest. */
export const PC_INFO_SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
function Safe([scriptblock]$block) { try { & $block } catch { $null } }
$eft = Safe { (Get-ItemProperty 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov').InstallLocation }
$eftDisk = $null
if ($eft -and $eft.Length -ge 2) { $eftDisk = Safe { $number = (Get-Partition -DriveLetter $eft.Substring(0, 1)).DiskNumber; Get-PhysicalDisk | Where-Object { $_.DeviceId -eq [string]$number } | Select-Object -First 1 MediaType, BusType } }
[pscustomobject]@{
  cpu = Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 Name, Manufacturer, NumberOfCores, NumberOfLogicalProcessors }
  gpus = @(Safe { Get-CimInstance Win32_VideoController | Select-Object Name, AdapterCompatibility, DriverVersion, @{ n = 'DriverDate'; e = { if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } } }, PNPDeviceID })
  system = Safe { Get-CimInstance Win32_ComputerSystem | Select-Object TotalPhysicalMemory, AutomaticManagedPagefile, PCSystemType }
  board = Safe { Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer, Product }
  memory = @(Safe { Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity, Speed, ConfiguredClockSpeed })
  os = Safe { Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber }
  pageFiles = @(Safe { Get-CimInstance Win32_PageFileSetting | Select-Object Name, InitialSize, MaximumSize })
  pageUsage = @(Safe { Get-CimInstance Win32_PageFileUsage | Select-Object Name, AllocatedBaseSize })
  gameFolder = $eft
  gameDisk = $eftDisk
} | ConvertTo-Json -Depth 4 -Compress
`

/** `powershell -EncodedCommand`: the script as UTF-16LE base64, so no quoting can break it. */
export const encodePowerShell = (script: string) => Buffer.from(script, 'utf16le').toString('base64')

/** Intel chipsets without memory overclocking: the memory runs at the processor's own speed whatever the modules say. */
const LOCKED_MEMORY_BOARD = /\b(?:H410|B460|H470|H510|H610)/i

type Raw = Record<string, unknown>
const record = (value: unknown): Raw => (value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {})
const list = (value: unknown): Raw[] => (Array.isArray(value) ? value : value == null ? [] : [value]).map(record).filter((entry) => Object.keys(entry).length > 0)
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number(text(value)) || 0)

/** The maker from the PCI id first (a card without its driver is «Microsoft Basic Display Adapter»), then the names. */
function vendorOf(name: string, company: string, pnp: string): PcInfo['gpus'][number]['vendor'] {
  if (pnp.includes('VEN_10DE')) return 'nvidia'
  if (pnp.includes('VEN_1002') || pnp.includes('VEN_1022')) return 'amd'
  if (pnp.includes('VEN_8086')) return 'intel'
  const both = `${company} ${name}`.toLowerCase()
  if (both.includes('nvidia')) return 'nvidia'
  if (both.includes('advanced micro devices') || /\b(amd|ati|radeon)\b/.test(both)) return 'amd'
  if (both.includes('intel')) return 'intel'
  return 'other'
}

/** NVIDIA's Windows driver version 32.0.16.1714 is the driver 617.14 people know. */
export function nvidiaDriver(windowsVersion: string) {
  const parts = windowsVersion.split('.')
  if (parts.length !== 4) return windowsVersion
  const digits = `${parts[2]}${parts[3]!.padStart(4, '0')}`.slice(-5)
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)}.${digits.slice(3)}` : windowsVersion
}

export function parsePcInfo(json: string): PcInfo {
  const raw = record(JSON.parse(json))
  const cpu = record(raw.cpu)
  const cpuName = text(cpu.Name).replace(/\s+/g, ' ')
  const system = record(raw.system)
  const board = record(raw.board)
  const os = record(raw.os)
  const memory = list(raw.memory)
  const rated = Math.min(...memory.map((module) => number(module.Speed)).filter((speed) => speed > 0))
  const running = Math.min(...memory.map((module) => number(module.ConfiguredClockSpeed)).filter((speed) => speed > 0))
  const gpus = list(raw.gpus).flatMap((gpu): PcInfo['gpus'] => {
    const name = text(gpu.Name)
    const pnp = text(gpu.PNPDeviceID).toUpperCase()
    // Virtual displays (ROOT\…) and remote sessions are no video card.
    if (!name || pnp.startsWith('ROOT\\') || /remote display|virtual/i.test(name)) return []
    const vendor = vendorOf(name, text(gpu.AdapterCompatibility), pnp)
    const version = text(gpu.DriverVersion)
    const date = text(gpu.DriverDate)
    return [{
      name, vendor,
      driver: vendor === 'nvidia' ? nvidiaDriver(version) : version,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(date) ? { driverDate: date } : {}),
      // A real card Windows runs with its basic driver: the vendor's driver is not installed.
      ...(/microsoft basic display/i.test(name) ? { noDriver: true as const } : {}),
    }]
  })
  const files = list(raw.pageFiles).map((file) => ({ path: text(file.Name), initialMb: number(file.InitialSize), maxMb: number(file.MaximumSize) })).filter((file) => file.path)
  const gameFolder = text(raw.gameFolder)
  const disk = record(raw.gameDisk)
  const media = text(disk.MediaType).toUpperCase()
  const ramBytes = number(system.TotalPhysicalMemory)
  const cpuVendor = /intel/i.test(`${text(cpu.Manufacturer)} ${cpuName}`) ? 'intel' : /amd/i.test(`${text(cpu.Manufacturer)} ${cpuName}`) ? 'amd' : 'other'
  const boardName = text(board.Product).toLowerCase().startsWith(text(board.Manufacturer).toLowerCase()) ? text(board.Product) || null : [text(board.Manufacturer), text(board.Product)].filter(Boolean).join(' ') || null
  return {
    cpu: cpuName ? { name: cpuName, vendor: cpuVendor, cores: number(cpu.NumberOfCores), threads: number(cpu.NumberOfLogicalProcessors) } : null,
    gpus,
    ramGb: ramBytes > 0 ? Math.round(ramBytes / 1024 ** 3) : null,
    ramMhz: Number.isFinite(rated) && Number.isFinite(running) ? { rated, running, ...(cpuVendor === 'intel' && LOCKED_MEMORY_BOARD.test(boardName ?? '') ? { locked: true as const } : {}) } : null,
    // «GALAX» + «GALAX H410M»: the maker once.
    board: boardName,
    windows: text(os.Caption) ? { name: text(os.Caption).replace(/^Майкрософт\s+|^Microsoft\s+/i, ''), build: number(os.BuildNumber) } : null,
    // Win32_ComputerSystem.PCSystemType: 2 = mobile.
    laptop: number(system.PCSystemType) === 2,
    pageFile: typeof system.AutomaticManagedPagefile === 'boolean'
      ? { automatic: system.AutomaticManagedPagefile, files, allocatedMb: list(raw.pageUsage).reduce((sum, usage) => sum + number(usage.AllocatedBaseSize), 0) }
      : null,
    game: /^[a-z]:\\/i.test(gameFolder) ? { folder: gameFolder.replace(/\\+$/, ''), drive: gameFolder.slice(0, 1).toUpperCase(), media: media === 'SSD' ? 'SSD' : media === 'HDD' ? 'HDD' : 'unknown' } : null,
  }
}

/** Reads the computer; null when PowerShell does not answer (not Windows, blocked, too slow). */
export async function readPcInfo(run: (file: string, args: string[], timeoutMs?: number) => Promise<string>, powershell: string): Promise<PcInfo | null> {
  try {
    const output = await run(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShell(PC_INFO_SCRIPT)], 30_000)
    const json = output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1)
    return json ? parsePcInfo(json) : null
  } catch {
    return null
  }
}
