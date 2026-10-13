import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildLogFolderCandidates, buildUserLogFolderCandidates, freshestLogsFolder, gameLogFolders, launchTime, normalizeSelectedLogsFolder, parseLauncherGamesRoot, parseRegExport, parseSteamInstallDir, parseSteamLibraryFolders, registeredGameFolders, searchDrivesForLogFolders, steamLibraries, steamLogFolderCandidates, steamRoots, type SteamFiles } from './logDiscovery.js'

describe('EFT log discovery', () => {
  it('reads the games root from BSG Launcher settings', () => {
    expect(parseLauncherGamesRoot(JSON.stringify({ gamesRootDir: 'D:\\Battlestate Games' })))
      .toBe('D:\\Battlestate Games')
  })

  it('ignores damaged launcher settings', () => {
    expect(parseLauncherGamesRoot('{damaged')).toBeUndefined()
  })

  it('prioritizes the launcher root and supports current and legacy folder names', () => {
    const candidates = buildLogFolderCandidates('D:\\Battlestate Games', ['C:', 'D:'])

    expect(candidates[0]).toBe('D:\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(candidates).toContain('D:\\Battlestate Games\\EFT\\Logs')
    expect(candidates).toContain('C:\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it('knows the Steam version\'s folders too', () => {
    const candidates = buildLogFolderCandidates(undefined, ['D:'])
    expect(candidates).toContain('D:\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\build\\Logs')
  })

  it('checks per-user locations when the launcher does not expose the install root', () => {
    const candidates = buildUserLogFolderCandidates('C:\\Users\\Tester\\AppData\\Roaming')
    expect(candidates).toContain('C:\\Users\\Tester\\AppData\\Local\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(candidates).toContain('C:\\Users\\Tester\\Documents\\Escape from Tarkov\\Logs')
  })

  it('reads the launch time from the folder name (the hour is not zero-padded)', () => {
    expect(launchTime('log_2026.09.27_2-33-45_1.1.5.1')).toBe(Date.UTC(2026, 8, 27, 2, 33, 45))
    expect(launchTime('notes')).toBe(0)
  })

  it('takes the Logs folder the game started in last, not an old one that still exists (owner, 12.10.2026)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raidos-logs-'))
    const old = join(root, 'C', 'Battlestate Games', 'EFT', 'Logs')
    const current = join(root, 'D', 'Games', 'Escape from Tarkov', 'Logs')
    await mkdir(join(old, 'log_2026.09.28_19-02-11_1.1.4.0'), { recursive: true })
    await mkdir(join(current, 'log_2026.10.12_8-15-00_1.1.5.1'), { recursive: true })
    await mkdir(join(current, 'log_2026.10.01_21-40-02_1.1.5.1'), { recursive: true })
    expect(await freshestLogsFolder([old, current])).toBe(current)
    expect(await freshestLogsFolder([current, old])).toBe(current)
    expect(await freshestLogsFolder([undefined, old])).toBe(old)
    expect(await freshestLogsFolder([])).toBeUndefined()
  })
})

// The Steam version (owner, 13.10.2026: «у него стим версия таркова, скорее всего логи лежат вообще в другом месте»).
const LIBRARIES = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"apps"
\t\t{
\t\t\t"228980"\t\t"3459012"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"E:\\\\Games\\\\SteamLib"
\t\t"apps"
\t\t{
\t\t\t"3932890"\t\t"52345671234"
\t\t}
\t}
}`
const MANIFEST = `"AppState"
{
\t"appid"\t\t"3932890"
\t"name"\t\t"Escape from Tarkov"
\t"installdir"\t\t"Escape from Tarkov"
}`

function fakeDisk(files: Record<string, string>, folders: Record<string, string[]>): SteamFiles {
  return {
    read: async (path) => { if (!(path in files)) throw new Error(`ENOENT ${path}`); return files[path]! },
    list: async (path) => { if (!(path in folders)) throw new Error(`ENOENT ${path}`); return folders[path]! },
  }
}

describe('EFT log discovery: the Steam version', () => {
  it('reads every library from libraryfolders.vdf and the game folder from its app manifest', () => {
    expect(parseSteamLibraryFolders(LIBRARIES)).toEqual(['C:\\Program Files (x86)\\Steam', 'E:\\Games\\SteamLib'])
    expect(parseSteamInstallDir(MANIFEST)).toBe('Escape from Tarkov')
    expect(parseSteamInstallDir('"installdir"  "..\\\\Windows"')).toBeUndefined()
    expect(parseSteamInstallDir('"installdir"  "C:\\\\x"')).toBeUndefined()
    expect(parseSteamLibraryFolders('not a vdf')).toEqual([])
  })

  it('looks in build\\Logs of the game in a library on any drive and folder, not in Arena', async () => {
    const disk = fakeDisk(
      {
        'C:\\Program Files (x86)\\Steam\\steamapps\\libraryfolders.vdf': LIBRARIES,
        'E:\\Games\\SteamLib\\steamapps\\appmanifest_3932890.acf': MANIFEST,
      },
      { 'E:\\Games\\SteamLib\\steamapps\\common': ['Escape from Tarkov', 'Escape from Tarkov Arena', 'Counter-Strike Global Offensive'] },
    )
    const candidates = await steamLogFolderCandidates(['C:\\Program Files (x86)\\Steam', 'D:\\Steam'], disk)
    expect(candidates).toContain('E:\\Games\\SteamLib\\steamapps\\common\\Escape from Tarkov\\build\\Logs')
    expect(candidates).toContain('E:\\Games\\SteamLib\\steamapps\\common\\Escape from Tarkov\\Logs')
    expect(candidates).toContain('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Escape from Tarkov\\build\\Logs')
    expect(candidates.some((path) => /arena|counter-strike/i.test(path))).toBe(false)
    // A folder without Steam's library list is no library.
    expect(candidates.some((path) => path.startsWith('D:'))).toBe(false)
    expect(new Set(candidates.map((path) => path.toLowerCase())).size).toBe(candidates.length)
  })

  it('finds a renamed game folder through the manifest or its name', async () => {
    const disk = fakeDisk(
      {
        'D:\\Steam\\steamapps\\libraryfolders.vdf': '"libraryfolders" { "0" { "path" "D:\\\\Steam" } }',
        'D:\\Steam\\steamapps\\appmanifest_3932890.acf': '"AppState" { "installdir" "EscapeFromTarkov" }',
      },
      { 'D:\\Steam\\steamapps\\common': ['Tarkov Old Copy'] },
    )
    const candidates = await steamLogFolderCandidates(['D:\\Steam'], disk)
    expect(candidates[0]).toBe('D:\\Steam\\steamapps\\common\\EscapeFromTarkov\\build\\Logs')
    expect(candidates).toContain('D:\\Steam\\steamapps\\common\\Tarkov Old Copy\\build\\Logs')
  })

  it('takes Steam from the registry first, then the usual folders', async () => {
    const roots = await steamRoots(async (key, name) => (key.startsWith('HKCU') && name === 'SteamPath' ? 'd:/games/steam' : undefined), ['C:'])
    expect(roots[0]).toBe('d:\\games\\steam')
    expect(roots).toContain('C:\\Program Files (x86)\\Steam')
    expect(roots).toContain('C:\\Steam')
    const failing = await steamRoots(async () => { throw new Error('reg.exe is missing') }, ['C:'])
    expect(failing[0]).toBe('C:\\Program Files (x86)\\Steam')
  })

  it('«Выбрать папку Logs» on the Steam game folder takes build/Logs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raidos-steam-'))
    const game = join(root, 'steamapps', 'common', 'Escape from Tarkov')
    await mkdir(join(game, 'build', 'Logs', 'log_2026.10.13_9-00-00_1.0.0.1'), { recursive: true })
    expect(await normalizeSelectedLogsFolder(game)).toBe(join(game, 'build', 'Logs'))
    expect(await normalizeSelectedLogsFolder(join(game, 'build'))).toBe(join(game, 'build', 'Logs'))
    expect(await normalizeSelectedLogsFolder(join(game, 'build', 'Logs'))).toBe(join(game, 'build', 'Logs'))
  })
})


// Still not found for the player after 0.6.0.29 (owner, 13.10.2026: «человеку не помог наш способ», «до сих пор не находит»).
describe('EFT log discovery: wherever the game is', () => {
  it('reads a registry value in any letters from `reg export` (UTF-16), not from its subkeys', () => {
    const steam = '\uFEFFWindows Registry Editor Version 5.00\r\n\r\n[HKEY_CURRENT_USER\\Software\\Valve\\Steam]\r\n"SteamExe"="d:/игры/steam/steam.exe"\r\n"SteamPath"="d:/игры/steam"\r\n\r\n[HKEY_CURRENT_USER\\Software\\Valve\\Steam\\Apps]\r\n"Language"="russian"\r\n'
    expect(parseRegExport(Buffer.from(steam, 'utf16le').toString('utf16le'), 'steampath')).toBe('d:/игры/steam')
    expect(parseRegExport(steam, 'Language')).toBeUndefined()
    const entry = '[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890]\r\n"DisplayName"="Escape from Tarkov"\r\n"InstallLocation"="E:\\\\Игры\\\\SteamLibrary\\\\steamapps\\\\common\\\\Escape from Tarkov"\r\n'
    expect(parseRegExport(entry, 'InstallLocation')).toBe('E:\\Игры\\SteamLibrary\\steamapps\\common\\Escape from Tarkov')
    expect(parseRegExport(entry, 'Missing')).toBeUndefined()
  })

  it('takes the game folder from Windows\' entries of Steam\'s app and of the BSG launcher', async () => {
    const folders = await registeredGameFolders(async (key, name) => {
      if (name !== 'InstallLocation') return undefined
      if (key === 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Steam App 3932890') return 'E:\\Игры\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\'
      if (key === 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov') return '"C:\\Battlestate Games\\EFT"'
      if (key.startsWith('HKCU')) return 'not\\a\\full\\path'
      throw new Error('no such key')
    })
    expect(folders).toEqual(['E:\\Игры\\SteamLibrary\\steamapps\\common\\Escape from Tarkov', 'C:\\Battlestate Games\\EFT'])
    expect(gameLogFolders(folders[0]!)).toEqual(['E:\\Игры\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\build\\Logs', 'E:\\Игры\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\Logs'])
  })

  it('a Steam folder is a library with only config\\libraryfolders.vdf, or with steamapps and no list at all', async () => {
    const disk = fakeDisk(
      { 'D:\\Игры\\Steam\\config\\libraryfolders.vdf': '"libraryfolders" { "1" { "path" "F:\\\\Библиотека" } }' },
      { 'C:\\Steam\\steamapps': ['common'] },
    )
    expect(await steamLibraries(['D:\\Игры\\Steam', 'C:\\Steam', 'X:\\Nope'], disk)).toEqual(['D:\\Игры\\Steam', 'F:\\Библиотека', 'C:\\Steam'])
  })

  it('looks through the drives: Steam libraries and game folders three levels down, not Windows\' or the users\' folders', async () => {
    const disk = fakeDisk(
      { 'G:\\Игры\\Steam\\steamapps\\appmanifest_3932890.acf': MANIFEST },
      {
        'C:\\': ['Windows', 'Users', 'Program Files'],
        'C:\\Windows': ['Escape from Tarkov'],
        'C:\\Users': ['Tarkov'],
        'C:\\Program Files': ['Common Files'],
        'G:\\': ['Фото', 'Игры'],
        'G:\\Игры': ['Steam'],
        'G:\\Игры\\Steam': ['bin', 'steamapps'],
        'G:\\Игры\\Steam\\steamapps': ['common'],
        'G:\\Игры\\Steam\\steamapps\\common': ['Escape from Tarkov', 'Escape from Tarkov Arena'],
        'H:\\': ['Games'],
        'H:\\Games': ['Battlestate Games'],
        'H:\\Games\\Battlestate Games': ['Escape from Tarkov'],
      },
    )
    const found = await searchDrivesForLogFolders(['C:', 'G:', 'H:', 'Q:'], disk)
    expect(found).toContain('G:\\Игры\\Steam\\steamapps\\common\\Escape from Tarkov\\build\\Logs')
    expect(found).toContain('H:\\Games\\Battlestate Games\\Escape from Tarkov\\Logs')
    expect(found.some((path) => /^C:\\(Windows|Users)|arena/i.test(path))).toBe(false)
    // Out of time: nothing more is listed.
    expect(await searchDrivesForLogFolders(['G:'], disk, Date.now() - 1)).toEqual([])
  })

  it('«Выбрать папку Logs» takes the game\'s Logs from a Steam library, steamapps, common, a launch folder or a drive', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raidos-pick-'))
    const library = join(root, 'SteamLibrary')
    const logs = join(library, 'steamapps', 'common', 'Escape from Tarkov', 'build', 'Logs')
    const launch = join(logs, 'log_2026.10.13_9-00-00_1.0.0.1')
    await mkdir(launch, { recursive: true })
    await mkdir(join(library, 'steamapps', 'common', 'Escape from Tarkov Arena', 'Logs', 'log_2026.10.14_9-00-00_0.4.0.1'), { recursive: true })
    for (const picked of [root, library, join(library, 'steamapps'), join(library, 'steamapps', 'common'), launch]) {
      expect(await normalizeSelectedLogsFolder(picked), picked).toBe(logs)
    }
    const empty = join(root, 'Пусто')
    await mkdir(empty)
    expect(await normalizeSelectedLogsFolder(empty)).toBe(empty)
  })
})
