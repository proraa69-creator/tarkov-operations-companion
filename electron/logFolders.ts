import { posix, win32 } from 'node:path'

/**
 * Which folders `logs:start-watching` may watch (unit-tested in logFolders.test.ts). The page cannot name an arbitrary
 * folder: only the game's Logs folder found by discoverEftLogs, or a folder the player picked in the folder dialog
 * (in this session, or remembered by the main process from an earlier one — never taken from the page's storage).
 */
export function sameFolder(a: string, b: string, windows = process.platform === 'win32') {
  if (!a || !b) return false
  const path = windows ? win32 : posix
  const clean = (value: string) => path.normalize(value).replace(/[\\/]+$/, '')
  return windows ? clean(a).toLowerCase() === clean(b).toLowerCase() : clean(a) === clean(b)
}

export class LogFolderGrants {
  private readonly folders: string[] = []
  constructor(private readonly windows = process.platform === 'win32') {}

  grant(folder: string | undefined | null) {
    if (folder && !this.has(folder)) this.folders.push(folder)
  }

  has(folder: string) {
    return this.folders.some((entry) => sameFolder(entry, folder, this.windows))
  }
}

/**
 * True when `folder` may be watched: granted in this session, the folder the player picked in the dialog earlier
 * (`remembered`), or the game's Logs folder found right now (`discover`, asked only when needed).
 */
export async function mayWatchLogFolder(folder: unknown, options: { grants: LogFolderGrants; remembered: () => Promise<string>; discover: () => Promise<string | undefined>; windows?: boolean }) {
  if (typeof folder !== 'string' || !folder || folder.length > 1024) return false
  const windows = options.windows ?? process.platform === 'win32'
  if (options.grants.has(folder)) return true
  const remembered = await options.remembered().catch(() => '')
  const allowed = sameFolder(folder, remembered, windows) || sameFolder(folder, (await options.discover().catch(() => undefined)) ?? '', windows)
  if (allowed) options.grants.grant(folder)
  return allowed
}
