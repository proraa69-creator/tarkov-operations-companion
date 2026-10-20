/**
 * The player's position and the recognised item on the phone's «Карты» (mobile/PhoneMapsPage.tsx): the desktop app
 * (which reads the EFT screenshots and the item tooltips) publishes them to the server's live relay, and the phone waits
 * on it (owner, 15.10.2026: «моментальное местоположение в мобильном приложении и показ цены тоже моментальный»): a new
 * value arrives within about a second. While the relay cannot be reached (offline, a server from before it, no access)
 * the stored position is polled every few seconds instead, and the relay is tried again each time. Only while the page
 * is open and the app is visible.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { setRecognisedItem } from '../items/recognisedItem'
import { fetchLiveState, fetchServerPosition, followPcGameMode, POSITION_POLL_MS, type ServerPosition } from '../sync/serverSync'
import { isAndroidApp } from '../platform'

export interface LivePositionValue {
  position: ServerPosition | null
  /** true while the position is fresh (see positionFreshness); a stale one is drawn dimmed. */
  fresh: boolean
  /** Keep the map centred on the player (the user dragging the map turns it off). */
  follow: boolean
  setFollow: (value: boolean) => void
}

/** Provided by the phone's «Карты»; LivePlayerMarker uses it instead of the desktop screenshot feed. */
export const LivePositionContext = createContext<LivePositionValue | null>(null)

export function useLivePositionContext() {
  return useContext(LivePositionContext)
}

export interface PositionPollState {
  position: ServerPosition | null
  /** Time of the last successful answer (null = none yet or the server/account is not reachable). */
  checkedAt: number | null
  loading: boolean
  /** The relay pushes now; false while the phone falls back to polling the stored position. */
  push: boolean
}

function documentHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

/**
 * The feed waits while the app is in the background — except in the Android app, where it keeps listening so an item
 * looked up on the PC still arrives as the phone's notification with the app minimised (owner, 18.10.2026). iOS stops a
 * background app's page itself.
 */
function feedPaused() {
  return documentHidden() && !isAndroidApp()
}

const newer = (next: ServerPosition | null, current: ServerPosition | null) => (next && (!current || next.at >= current.at) ? next : current)

/**
 * Waits on GET /v1/live/:mode (the PC's position and recognised item, pushed); falls back to polling GET
 * /v1/me/position/:mode every `intervalMs` while the wait fails. Pauses while the app is in the background (not in the Android app: feedPaused). Keeps the last
 * known position of the mode; a new item becomes the card under «Вид» (items/recognisedItem.ts).
 */
export function useServerPositionPoll(mode: RaidMode, intervalMs = POSITION_POLL_MS): PositionPollState {
  const [result, setResult] = useState<PositionPollState & { mode: RaidMode }>({ mode, position: null, checkedAt: null, loading: true, push: false })

  useEffect(() => {
    let alive = true
    let running = false
    let timer: number | undefined
    let version: number | undefined
    /** The item already shown (its time): the same one coming again on the next answer is not shown again. */
    let itemAt: number | null = null
    const update = (position: ServerPosition | null, push: boolean, ok: boolean) => setResult((current) => {
      const own = current.mode === mode
      return {
        mode,
        // A failed answer keeps the last known position of this mode.
        position: newer(position, own ? current.position : null),
        checkedAt: ok ? Date.now() : own ? current.checkedAt : null,
        loading: false,
        push,
      }
    })
    const loop = async () => {
      if (running) return
      running = true
      try {
        while (alive && !feedPaused()) {
          const live = await fetchLiveState(mode, version).catch(() => null)
          if (!alive) return
          if (live) {
            version = live.version
            // The PC is in another mode: the app switches there (this feed then listens to that mode).
            if (live.gameMode) followPcGameMode(live.gameMode)
            update(live.position, true, true)
            if (live.item && live.item.at !== itemAt) {
              itemAt = live.item.at
              setRecognisedItem(live.item.payload, { at: live.item.at, mode, from: 'server' })
            }
            continue
          }
          // The push channel is down: the stored position, then the relay again after a pause.
          version = undefined
          const position = await fetchServerPosition(mode).catch(() => null)
          if (!alive) return
          update(position, false, position !== null)
          await new Promise<void>((resolve) => { timer = window.setTimeout(resolve, intervalMs) })
        }
      } finally {
        running = false
      }
    }
    const onVisibility = () => { if (!feedPaused()) void loop() }
    void loop()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [mode, intervalMs])

  // One object while the new mode waits for its first answer: a fresh one each render would make LiveFeedRunner publish on
  // every render of the shell that reads the feed — an endless loop on each mode switch (React #185, owner 20.10.2026).
  return result.mode === mode ? result : IDLE_POLL
}
const IDLE_POLL: PositionPollState = { position: null, checkedAt: null, loading: true, push: false }

/**
 * The live feed runs for the whole app on the phone, not only on «Карты» (owner, 17.10.2026: «я нажал скриншот, точка
 * появилась моментально на пк и на телефоне»; the item card must reach the phone on any screen): AppShell mounts
 * `LiveFeedRunner` once, the pages read the latest state with `useLiveFeed`.
 */
type FeedState = PositionPollState & { mode: RaidMode }
let feed: FeedState | null = null
const feedListeners = new Set<() => void>()

export function publishLiveFeed(state: FeedState) {
  feed = state
  for (const listener of feedListeners) listener()
}

const subscribeFeed = (listener: () => void) => { feedListeners.add(listener); return () => { feedListeners.delete(listener) } }

export function useLiveFeed(mode: RaidMode): PositionPollState {
  const state = useSyncExternalStore(subscribeFeed, () => feed, () => feed)
  return state && state.mode === mode ? state : EMPTY_FEED
}
const EMPTY_FEED: PositionPollState = { position: null, checkedAt: null, loading: true, push: false }

export function LiveFeedRunner({ mode }: { mode: RaidMode }) {
  const poll = useServerPositionPoll(mode)
  useEffect(() => { publishLiveFeed({ ...poll, mode }) }, [poll, mode])
  return null
}
