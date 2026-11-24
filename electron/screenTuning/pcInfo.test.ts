import { describe, expect, it } from 'vitest'
import { encodePowerShell, nvidiaDriver, parsePcInfo, PC_INFO_SCRIPT } from './pcInfo'

/** What PowerShell answered on the owner's PC (03.11.2026), with a virtual monitor driver beside the real card. */
const OWNER_PC = JSON.stringify({
  cpu: { Name: 'Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz', Manufacturer: 'GenuineIntel', NumberOfCores: 6, NumberOfLogicalProcessors: 12 },
  gpus: [
    { Name: 'Virtual Display Driver', AdapterCompatibility: 'MikeTheTech', DriverVersion: '11.30.4.434', DriverDate: '2024-12-24', PNPDeviceID: 'ROOT\\DISPLAY\\0000' },
    { Name: 'NVIDIA GeForce RTX 3060 Ti', AdapterCompatibility: 'NVIDIA', DriverVersion: '32.0.16.1714', DriverDate: '2026-09-17', PNPDeviceID: 'PCI\\VEN_10DE&DEV_2489&SUBSYS_88271043&REV_A1\\4&187B46FD&0&0008' },
  ],
  system: { TotalPhysicalMemory: 17106620416, AutomaticManagedPagefile: false, PCSystemType: 1 },
  board: { Manufacturer: 'GALAX', Product: 'GALAX H410M' },
  memory: [{ Capacity: 8589934592, Speed: 3200, ConfiguredClockSpeed: 2667 }, { Capacity: 8589934592, Speed: 3200, ConfiguredClockSpeed: 2667 }],
  os: { Caption: 'Майкрософт Windows 10 Pro', BuildNumber: '19045' },
  pageFiles: [{ Name: 'D:\\pagefile.sys', InitialSize: 32768, MaximumSize: 49152 }],
  pageUsage: [{ Name: 'D:\\pagefile.sys', AllocatedBaseSize: 32768 }],
  gameFolder: 'C:\\Battlestate Games\\Escape from Tarkov',
  gameDisk: { MediaType: 'SSD', BusType: 'NVMe' },
})

describe('«Ваш компьютер»: what Windows says about the PC', () => {
  it('reads the owner\'s PC: the real video card only, its NVIDIA driver number, memory held back by the board, the page file and the game\'s disk', () => {
    expect(parsePcInfo(OWNER_PC)).toEqual({
      cpu: { name: 'Intel(R) Core(TM) i5-10400F CPU @ 2.90GHz', vendor: 'intel', cores: 6, threads: 12 },
      gpus: [{ name: 'NVIDIA GeForce RTX 3060 Ti', vendor: 'nvidia', driver: '617.14', driverDate: '2026-09-17' }],
      ramGb: 16,
      ramMhz: { rated: 3200, running: 2667, locked: true },
      board: 'GALAX H410M',
      windows: { name: 'Windows 10 Pro', build: 19045 },
      laptop: false,
      pageFile: { automatic: false, files: [{ path: 'D:\\pagefile.sys', initialMb: 32768, maxMb: 49152 }], allocatedMb: 32768 },
      game: { folder: 'C:\\Battlestate Games\\Escape from Tarkov', drive: 'C', media: 'SSD' },
    })
  })

  it('a card without its driver, a laptop, one module, an unlocked board, an unknown game folder', () => {
    const info = parsePcInfo(JSON.stringify({
      cpu: { Name: 'AMD Ryzen 7 7800X3D 8-Core Processor', Manufacturer: 'AuthenticAMD', NumberOfCores: 8, NumberOfLogicalProcessors: 16 },
      gpus: { Name: 'Microsoft Basic Display Adapter', AdapterCompatibility: '(Standard display types)', DriverVersion: '10.0.19041.1', PNPDeviceID: 'PCI\\VEN_1002&DEV_744C' },
      system: { TotalPhysicalMemory: 34359738368, AutomaticManagedPagefile: true, PCSystemType: 2 },
      board: { Manufacturer: 'ASUSTeK COMPUTER INC.', Product: 'ROG STRIX B650-A' },
      memory: { Capacity: 34359738368, Speed: 6000, ConfiguredClockSpeed: 4800 },
      os: { Caption: 'Microsoft Windows 11 Home', BuildNumber: '22631' },
      pageFiles: null,
      gameFolder: null,
    }))
    // An AMD card (PCI VEN_1002) Windows runs with its basic driver.
    expect(info.gpus).toEqual([{ name: 'Microsoft Basic Display Adapter', vendor: 'amd', driver: '10.0.19041.1', noDriver: true }])
    expect(info.laptop).toBe(true)
    expect(info.ramMhz).toEqual({ rated: 6000, running: 4800 })
    expect(info.board).toBe('ASUSTeK COMPUTER INC. ROG STRIX B650-A')
    expect(info.windows).toEqual({ name: 'Windows 11 Home', build: 22631 })
    expect(info.pageFile).toEqual({ automatic: true, files: [], allocatedMb: 0 })
    expect(info.game).toBeNull()
  })

  it('NVIDIA\'s Windows driver numbers, and the script travels whole as UTF-16 base64', () => {
    expect(nvidiaDriver('32.0.16.1714')).toBe('617.14')
    expect(nvidiaDriver('31.0.15.5222')).toBe('552.22')
    expect(nvidiaDriver('weird')).toBe('weird')
    expect(Buffer.from(encodePowerShell(PC_INFO_SCRIPT), 'base64').toString('utf16le')).toBe(PC_INFO_SCRIPT)
    // Read only: the script queries, it never sets anything.
    expect(PC_INFO_SCRIPT).not.toMatch(/Set-|New-|Remove-|reg(\.exe)? add|powercfg/i)
  })
})
