/**
 * Which window is the game's. It used to be told by its title: any window whose title held «Escape from Tarkov» or the
 * word «EFT» counted — a Discord channel «#eft-general», a wiki page, a YouTube video about the game, an Explorer folder.
 * With such a window in front the quest scanner copied and read that screen, and the hotkeys fired while typing (on the
 * Russian layout «;» and «M» are «ж» and «ь»): item lookups, the minimap, screenshots (players, 14.10.2026: «много людей
 * пишет что при использовании приложения начинает тупить экран и мышка»).
 *
 * Now the window's process tells: EscapeFromTarkov.exe — the BSG launcher's build and the Steam build alike; Arena is
 * EscapeFromTarkovArena.exe. The process's name is read with the least access Windows has (PROCESS_QUERY_LIMITED_INFORMATION,
 * as Task Manager does): nothing is read from, or done to, the game. Remembered per window, so the checks every few dozen
 * milliseconds cost two calls into Windows. When Windows refuses the name, the game's own window is recognised instead: the
 * exact title «EscapeFromTarkov» of the Unity window class.
 */

export const GAME_IMAGE = 'EscapeFromTarkov.exe'
export const GAME_TITLE = 'EscapeFromTarkov'
export const GAME_CLASS = 'UnityWndClass'

/** The Windows calls the check needs: koffi functions in win32.ts (bindGameWindowApi), fakes in the tests. */
export interface GameWindowApi {
  /** GetWindowThreadProcessId: the window's process id; 0 when the window is gone. */
  processId(hwnd: unknown): number
  /** The full path of the process's program; null when Windows refuses it (or the process is gone). */
  imagePath(pid: number): string | null
  title(hwnd: unknown): string
  className(hwnd: unknown): string
  /** The handle as a number, to remember the window by. */
  key(hwnd: unknown): bigint | number
}

/** A window seen in front: whether it is the game's, and its identity (handle and process), which a game restart changes. */
export interface GameWindowInfo {
  game: boolean
  /** Handle and process id: a new value is a new game window (the game was started again). */
  id: string
  pid: number
  /** How it was told: the process's program, or (Windows refused that) the window's title and class. */
  via: 'process' | 'window'
}

/** The program is the game's: its file name, in any letters, wherever it is installed. */
export function isGameImagePath(path: string) {
  const name = path.split(/[\\/]/).pop() ?? ''
  return name.toLowerCase() === GAME_IMAGE.toLowerCase()
}

/** The game's window by its title alone (desktopCapturer names sources by title): exactly «EscapeFromTarkov». */
export function isGameWindowTitle(title: string) {
  return title.trim() === GAME_TITLE
}

/** The game's window by its title and window class (when the process cannot be asked). */
export function isGameWindowTitleAndClass(title: string, className: string) {
  return isGameWindowTitle(title) && className === GAME_CLASS
}

/** A process that refused its name is asked again after this long (it may have been starting). */
export const IMAGE_RETRY_MS = 10_000
/** Windows remembered at most (a few are in front in a session; the oldest go first). */
const WINDOWS_KEPT = 64

/** A Windows call that may fail (the window or the process went away meanwhile). */
function attempt<T>(call: () => T, fallback: T): T {
  try {
    return call()
  } catch {
    return fallback
  }
}

function keep<V>(map: Map<string, V>, id: string, value: V) {
  map.delete(id)
  map.set(id, value)
  while (map.size > WINDOWS_KEPT) map.delete(map.keys().next().value!)
}

/**
 * The check: `check(hwnd)` → null for no window, else whether it is the game's. A window's answer from its process is
 * kept (a window never changes its process; a reused handle has another process id, so it is asked again).
 */
export function createGameWindowCheck(api: GameWindowApi, now: () => number = Date.now) {
  const known = new Map<string, boolean>()
  const refused = new Map<string, number>()
  return (hwnd: unknown): GameWindowInfo | null => {
    if (!hwnd) return null
    const pid = attempt(() => api.processId(hwnd), 0)
    if (!pid) return null
    const id = `${api.key(hwnd)}:${pid}`
    const game = known.get(id)
    if (game !== undefined) return { game, id, pid, via: 'process' }
    const failedAt = refused.get(id)
    if (failedAt === undefined || now() - failedAt >= IMAGE_RETRY_MS) {
      const path = attempt(() => api.imagePath(pid), null)
      if (path) {
        refused.delete(id)
        const answer = isGameImagePath(path)
        keep(known, id, answer)
        return { game: answer, id, pid, via: 'process' }
      }
      keep(refused, id, now())
    }
    // The window may have gone meanwhile: then it is not the game's.
    const byWindow = attempt(() => isGameWindowTitleAndClass(api.title(hwnd), api.className(hwnd)), false)
    return { game: byWindow, id, pid, via: 'window' }
  }
}

/** koffi's library handle: `func` declares one function of the DLL. */
export interface KoffiLibrary { func: (signature: string) => (...args: unknown[]) => unknown }

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const PATH_CHARS = 1024

const text = (buffer: Uint16Array, length: number) => length > 0 ? String.fromCharCode(...buffer.subarray(0, Math.min(length, buffer.length))) : ''

/**
 * The calls through koffi: user32 GetWindowThreadProcessId, GetWindowTextW and GetClassNameW; kernel32 OpenProcess (least
 * access), QueryFullProcessImageNameW and CloseHandle. Without kernel32's functions every window is told by title and class.
 */
export function bindGameWindowApi(user32: KoffiLibrary, kernel32: KoffiLibrary | null, address: (pointer: unknown) => bigint): GameWindowApi {
  const threadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hWnd, _Out_ uint32_t* lpdwProcessId)')
  const windowText = user32.func('int __stdcall GetWindowTextW(void* hWnd, _Out_ uint16_t* lpString, int nMaxCount)')
  const classText = user32.func('int __stdcall GetClassNameW(void* hWnd, _Out_ uint16_t* lpClassName, int nMaxCount)')
  const openProcess = kernel32?.func('void* __stdcall OpenProcess(uint32 dwDesiredAccess, int bInheritHandle, uint32 dwProcessId)')
  const imageName = kernel32?.func('int __stdcall QueryFullProcessImageNameW(void* hProcess, uint32 dwFlags, _Out_ uint16_t* lpExeName, _Inout_ uint32_t* lpdwSize)')
  const closeHandle = kernel32?.func('int __stdcall CloseHandle(void* hObject)')
  return {
    processId(hwnd) {
      const pid = new Uint32Array(1)
      threadProcessId(hwnd, pid)
      return pid[0]!
    },
    imagePath(pid) {
      if (!openProcess || !imageName || !closeHandle) return null
      const process = openProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid)
      if (!process) return null
      try {
        const buffer = new Uint16Array(PATH_CHARS)
        const size = new Uint32Array([PATH_CHARS])
        return Number(imageName(process, 0, buffer, size)) ? text(buffer, size[0]!) || null : null
      } finally {
        closeHandle(process)
      }
    },
    title(hwnd) {
      const buffer = new Uint16Array(512)
      return text(buffer, Number(windowText(hwnd, buffer, buffer.length)))
    },
    className(hwnd) {
      const buffer = new Uint16Array(256)
      return text(buffer, Number(classText(hwnd, buffer, buffer.length)))
    },
    key: (hwnd) => address(hwnd),
  }
}

/** When each game window (handle and process) was first seen: a window not seen before is a game start. */
export function createGameSightings(limit = 8) {
  const firstSeen = new Map<string, number>()
  return (id: string, now: number) => {
    const known = firstSeen.get(id)
    if (known !== undefined) return known
    firstSeen.set(id, now)
    while (firstSeen.size > limit) firstSeen.delete(firstSeen.keys().next().value!)
    return now
  }
}
