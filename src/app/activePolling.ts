import { isAppActive, onAppActivityChange, startAppActivity } from './appActivity'

/**
 * Polling that never runs while the app sits behind the game (src/app/appActivity.ts: the window is in use when it is
 * visible and focused). `load` is called:
 * - at once;
 * - each time the window is used again (the player comes back from the game, the window is restored);
 * - every `activeEveryMs` while the window is in use, if given.
 * Nothing runs on a timer while the window is in the background or minimized. With Electron's `backgroundThrottling:
 * false` the page's timers are not slowed there, so a plain setInterval kept asking the main process — for
 * `experimental:status` each answer may read the registry and search the game's folders — the whole time the player
 * was in the game. Returns the function that stops it.
 */
export function startActivePolling(load: () => void, options: { activeEveryMs?: number } = {}): () => void {
  const stopActivity = startAppActivity()
  let timer: number | undefined
  const follow = () => {
    window.clearInterval(timer)
    timer = options.activeEveryMs && isAppActive() ? window.setInterval(load, options.activeEveryMs) : undefined
  }
  const stopFollowing = onAppActivityChange((active) => {
    if (active) load()
    follow()
  })
  load()
  follow()
  return () => {
    stopFollowing()
    window.clearInterval(timer)
    stopActivity()
  }
}
