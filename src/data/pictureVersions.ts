import { useEffect, useSyncExternalStore } from 'react'
import { serviceClient } from '../account/nicknameBinding'

/**
 * Pictures the server may replace (owner, 13.11.2026: «научи приложение сохранять все картинки у себя, а если у нас на сервере
 * происходит замена, то приложение берет один раз от туда новую картинку и сам меняет… ко всем картинкам, которые фото мест
 * показывают»): the «Оружейник» build screenshots the server keeps (server/src/routes/buildScreenshots.ts) and the owner's
 * replacements of photos of places (server/src/routes/guideImages.ts). The server names each with a version of its bytes;
 * the version goes into the picture's address, so the app (its browser cache, kept on disk) downloads a picture once and
 * again only when it was replaced. The list is kept on this device for the next start, offline too.
 */
export interface PictureVersions {
  /** «task:weapon» → version of the server's build screenshot. */
  builds: Record<string, string>
  /** A photo's file name («wiki-<id>[-t].<ext>») → version of its replacement. */
  guide: Record<string, string>
}

const KEY = 'raidos-picture-versions-v1'
const HOST = 'https://raidos.app'
const ID = /^[0-9a-f]{24}$/
const VERSION = /^[0-9a-f]{8,64}$/
const GUIDE_FILE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,120}\.(?:png|jpe?g|webp)$/
const EMPTY: PictureVersions = { builds: {}, guide: {} }

let state: PictureVersions = load()
const listeners = new Set<() => void>()

function load(): PictureVersions {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    return raw ? parsePictureVersions(JSON.parse(raw)) : EMPTY
  } catch { return EMPTY }
}

/** The kept or answered lists, checked: what is not a version of a known name is left out. */
export function parsePictureVersions(value: unknown): PictureVersions {
  const root = value && typeof value === 'object' ? value as { builds?: unknown; guide?: unknown } : {}
  const pick = (entries: unknown, key: (name: string) => boolean) => Object.fromEntries(Object.entries(entries && typeof entries === 'object' ? entries as Record<string, unknown> : {})
    .filter((entry): entry is [string, string] => key(entry[0]) && typeof entry[1] === 'string' && VERSION.test(entry[1])))
  return {
    builds: pick(root.builds, (name) => { const [task, weapon] = name.split(':'); return ID.test(task ?? '') && ID.test(weapon ?? '') }),
    guide: pick(root.guide, (name) => GUIDE_FILE.test(name)),
  }
}

function set(next: PictureVersions) {
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* kept for this run */ }
  for (const listener of listeners) listener()
}

/** The server's build screenshot of this task's weapon at its version's address, when the server has one. */
export function serverBuildScreenshot(taskId: string | undefined, weaponId: string): string | undefined {
  const version = taskId ? state.builds[`${taskId}:${weaponId}`] : undefined
  return version ? `${HOST}/v1/build-screenshots/${taskId}_${weaponId}.webp?v=${version}` : undefined
}

/** The version of the owner's replacement of a photo, when it was replaced on the server. */
export function guideReplacementVersion(file: string): string | undefined {
  return state.guide[file]
}

/** Asks the server for both lists (an older server: they stay as they were). */
export async function refreshPictureVersions(request = serviceClient()) {
  if (!request) return
  const [builds, guide] = await Promise.all([
    request('GET', '/v1/build-screenshots').catch(() => null) as Promise<{ screenshots?: Array<{ task?: unknown; weapon?: unknown; version?: unknown }> } | null>,
    request('GET', '/v1/guide-image-versions').catch(() => null) as Promise<{ versions?: unknown } | null>,
  ])
  set(parsePictureVersions({
    builds: builds?.screenshots ? Object.fromEntries(builds.screenshots.map((entry) => [`${String(entry.task)}:${String(entry.weapon)}`, entry.version])) : state.builds,
    guide: guide?.versions ?? state.guide,
  }))
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Re-renders when the lists change. */
export function usePictureVersions(): PictureVersions {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

/** Mounted once (AppShell): the lists at the start and every half hour. */
export function usePictureVersionsRefresh() {
  useEffect(() => {
    void refreshPictureVersions().catch(() => {})
    const timer = window.setInterval(() => void refreshPictureVersions().catch(() => {}), 30 * 60_000)
    return () => window.clearInterval(timer)
  }, [])
}
