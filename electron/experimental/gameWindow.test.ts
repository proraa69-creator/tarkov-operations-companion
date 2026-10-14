import { describe, expect, it } from 'vitest'
import { bindGameWindowApi, createGameSightings, createGameWindowCheck, IMAGE_RETRY_MS, isGameImagePath, isGameWindowTitle, type KoffiLibrary } from './gameWindow'

/** A window handle as koffi hands it out (an opaque pointer); `address` turns it into its number. */
interface Handle { hwnd: number }
interface FakeWindow { pid: number; title: string; className: string }

const LAUNCHER = 'C:\\Battlestate Games\\EFT\\EscapeFromTarkov.exe'
const STEAM = 'D:\\SteamLibrary\\steamapps\\common\\Escape from Tarkov\\build\\EscapeFromTarkov.exe'
const ARENA = 'C:\\Battlestate Games\\EFT Arena\\EscapeFromTarkovArena.exe'

/**
 * koffi with a desktop behind it: `func(signature)` hands out a fake of the declared function, found by its name. The
 * fakes keep what was called, so a test sees which processes were opened, how, and that every handle was closed.
 */
function fakeKoffi(windows: Map<number, FakeWindow>, images: Map<number, string | 'refused' | 'unreadable'>) {
  const calls = { declared: [] as string[], opened: [] as Array<{ access: number; pid: number }>, closed: 0, imageReads: 0 }
  const write = (value: string, buffer: Uint16Array, size: number) => {
    const length = Math.min(value.length, size - 1)
    for (let index = 0; index < length; index += 1) buffer[index] = value.charCodeAt(index)
    return length
  }
  const user32: Record<string, (...args: never[]) => unknown> = {
    GetWindowThreadProcessId: (handle: Handle, pid: Uint32Array) => { pid[0] = windows.get(handle.hwnd)?.pid ?? 0; return pid[0] ? 7 : 0 },
    GetWindowTextW: (handle: Handle, buffer: Uint16Array, size: number) => write(windows.get(handle.hwnd)?.title ?? '', buffer, size),
    GetClassNameW: (handle: Handle, buffer: Uint16Array, size: number) => write(windows.get(handle.hwnd)?.className ?? '', buffer, size),
  }
  const kernel32: Record<string, (...args: never[]) => unknown> = {
    OpenProcess: (access: number, inherit: number, pid: number) => {
      calls.opened.push({ access, pid })
      expect(inherit).toBe(0)
      return images.get(pid) === 'refused' || !images.has(pid) ? null : { pid }
    },
    QueryFullProcessImageNameW: (process: { pid: number }, flags: number, buffer: Uint16Array, size: Uint32Array) => {
      calls.imageReads += 1
      const image = images.get(process.pid)
      if (!image || image === 'unreadable' || image === 'refused') return 0
      size[0] = write(image, buffer, size[0]!)
      return 1
    },
    CloseHandle: () => { calls.closed += 1; return 1 },
  }
  const library = (functions: Record<string, (...args: never[]) => unknown>): KoffiLibrary => ({
    func: (signature) => {
      calls.declared.push(signature)
      const name = /__stdcall\s+(\w+)\s*\(/.exec(signature)?.[1] ?? ''
      const fake = functions[name]
      if (!fake) throw new Error(`no such function: ${name}`)
      return fake as (...args: unknown[]) => unknown
    },
  })
  return { user32: library(user32), kernel32: library(kernel32), address: (pointer: unknown) => BigInt((pointer as Handle).hwnd), calls }
}

function desktop(entries: Array<[number, FakeWindow]>, images: Array<[number, string | 'refused' | 'unreadable']>) {
  const windows = new Map(entries)
  const koffi = fakeKoffi(windows, new Map(images))
  let time = 1_000_000
  const check = createGameWindowCheck(bindGameWindowApi(koffi.user32, koffi.kernel32, koffi.address), () => time)
  return { check: (hwnd: number) => check({ hwnd }), koffi, windows, advance: (ms: number) => { time += ms } }
}

const unity = (title: string, pid: number): FakeWindow => ({ pid, title, className: 'UnityWndClass' })

describe('the game window, told by its process', () => {
  it('is the launcher build and the Steam build alike, never Arena', () => {
    const { check } = desktop(
      [[1, unity('EscapeFromTarkov', 100)], [2, unity('EscapeFromTarkov', 200)], [3, unity('EscapeFromTarkovArena', 300)], [4, unity('EscapeFromTarkov', 400)]],
      [[100, LAUNCHER], [200, STEAM], [300, ARENA], [400, 'C:\\Games\\Other\\SomeUnityGame.exe']],
    )
    expect(check(1)).toMatchObject({ game: true, via: 'process', pid: 100 })
    expect(check(2)).toMatchObject({ game: true, via: 'process' })
    expect(check(3)).toMatchObject({ game: false, via: 'process' })
    // Another Unity program that happens to carry the game's title.
    expect(check(4)).toMatchObject({ game: false, via: 'process' })
  })

  it('is not any window about the game: Discord, browsers, a video, a folder', () => {
    const { check } = desktop([
      [1, { pid: 10, title: '#eft-general | Tarkov Community - Discord', className: 'Chrome_WidgetWin_1' }],
      [2, { pid: 11, title: 'Escape from Tarkov — Яндекс Браузер', className: 'Chrome_WidgetWin_1' }],
      [3, { pid: 12, title: 'EFT wipe guide - YouTube — Mozilla Firefox', className: 'MozillaWindowClass' }],
      [4, { pid: 13, title: 'Escape from Tarkov', className: 'CabinetWClass' }],
    ], [[10, 'C:\\Users\\p\\AppData\\Local\\Discord\\app-1.0\\Discord.exe'], [11, 'C:\\Users\\p\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser.exe'], [12, 'C:\\Program Files\\Mozilla Firefox\\firefox.exe'], [13, 'C:\\Windows\\explorer.exe']])
    for (const hwnd of [1, 2, 3, 4]) expect(check(hwnd)?.game).toBe(false)
  })

  it('opens the process with the least access only, and closes every handle', () => {
    const { check, koffi } = desktop([[1, unity('EscapeFromTarkov', 100)], [2, unity('EscapeFromTarkov', 200)]], [[100, LAUNCHER], [200, 'unreadable']])
    check(1)
    check(2)
    expect(koffi.calls.opened.map((entry) => entry.access)).toEqual([0x1000, 0x1000])
    expect(koffi.calls.closed).toBe(2)
    // Nothing that could read or change the game is even declared.
    expect(koffi.calls.declared.join('\n')).not.toMatch(/ReadProcessMemory|WriteProcessMemory|CreateRemoteThread|VirtualAlloc|SendMessage|PostMessage/)
  })

  it('falls back to the exact title «EscapeFromTarkov» of the Unity window class when Windows refuses the process', () => {
    const { check } = desktop([
      [1, unity('EscapeFromTarkov', 100)],
      [2, unity('EscapeFromTarkovArena', 101)],
      [3, { pid: 102, title: 'EscapeFromTarkov', className: 'Chrome_WidgetWin_1' }],
      [4, unity('Escape from Tarkov', 103)],
      [5, unity('EscapeFromTarkov', 104)],
    ], [[100, 'refused'], [101, 'refused'], [102, 'refused'], [103, 'refused'], [104, 'unreadable']])
    expect(check(1)).toMatchObject({ game: true, via: 'window' })
    expect(check(2)?.game).toBe(false)
    expect(check(3)?.game).toBe(false)
    expect(check(4)?.game).toBe(false)
    // The process opened, but its name could not be read: the same fallback.
    expect(check(5)).toMatchObject({ game: true, via: 'window' })
  })

  it('asks Windows once per window, and again when a handle comes back with another process', () => {
    const { check, koffi, windows } = desktop([[1, unity('EscapeFromTarkov', 100)]], [[100, LAUNCHER], [500, 'C:\\Windows\\notepad.exe']])
    for (let poll = 0; poll < 50; poll += 1) expect(check(1)?.game).toBe(true)
    expect(koffi.calls.imageReads).toBe(1)
    // The game closed and Windows gave its handle to another program.
    windows.set(1, { pid: 500, title: 'EscapeFromTarkov', className: 'Notepad' })
    expect(check(1)?.game).toBe(false)
    expect(koffi.calls.imageReads).toBe(2)
    windows.delete(1)
    expect(check(1)).toBeNull()
  })

  it('asks a refusing process again after a while, meanwhile goes by the window', () => {
    const { check, koffi, advance } = desktop([[1, unity('EscapeFromTarkov', 100)]], [[100, 'refused']])
    check(1)
    check(1)
    expect(koffi.calls.opened).toHaveLength(1)
    advance(IMAGE_RETRY_MS)
    check(1)
    expect(koffi.calls.opened).toHaveLength(2)
  })

  it('works without kernel32: every window by its title and class', () => {
    const windows = new Map<number, FakeWindow>([[1, unity('EscapeFromTarkov', 100)], [2, { pid: 101, title: 'EscapeFromTarkov', className: 'Chrome_WidgetWin_1' }]])
    const koffi = fakeKoffi(windows, new Map())
    const check = createGameWindowCheck(bindGameWindowApi(koffi.user32, null, koffi.address))
    expect(check({ hwnd: 1 })).toMatchObject({ game: true, via: 'window' })
    expect(check({ hwnd: 2 })?.game).toBe(false)
    expect(check(null)).toBeNull()
  })
})

describe('game program and window names', () => {
  it('takes the program by its file name in any letters, wherever installed', () => {
    expect(isGameImagePath(LAUNCHER)).toBe(true)
    expect(isGameImagePath(STEAM)).toBe(true)
    expect(isGameImagePath('e:\\игры\\eft\\escapefromtarkov.EXE')).toBe(true)
    expect(isGameImagePath(ARENA)).toBe(false)
    expect(isGameImagePath('C:\\EscapeFromTarkov.exe\\launcher.exe')).toBe(false)
  })
  it('takes a desktopCapturer source only by the exact title', () => {
    expect(isGameWindowTitle('EscapeFromTarkov')).toBe(true)
    for (const title of ['EscapeFromTarkovArena', 'Escape from Tarkov', '#eft | Discord', 'EFT - YouTube', 'Raid OS']) expect(isGameWindowTitle(title)).toBe(false)
  })
})

describe('a game start', () => {
  it('is a game window not seen before; Alt+Tab back, a raid ending, the same window again are not', () => {
    const since = createGameSightings()
    expect(since('1:100', 1000)).toBe(1000)
    expect(since('1:100', 60_000)).toBe(1000)
    // The game started again: another process (and window).
    expect(since('9:300', 90_000)).toBe(90_000)
    expect(since('9:300', 400_000)).toBe(90_000)
  })
})
