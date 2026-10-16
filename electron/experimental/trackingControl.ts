import { remoteMinimapOn, setRemoteMinimap, trackingOn, type ExperimentalSettings } from './settings.js'

/** What the switch needs of the screenshots tracker (electron/experimental/positionTracker.ts). */
export interface TrackerLike {
  start(): Promise<void> | void
  stop(): void
  readonly running: boolean
}

/**
 * The position tracking on or off: the owner's switch for every app (`experimental:set-remote-minimap`, as the renderer
 * learnt it from the server, src/announcement/features.ts) and the player's own «Отключить местоположение». On: the
 * screenshots folders are followed. Off: nothing is followed, and `onOff` takes the dot off the maps.
 *
 * Any order works: the switch arriving after the start (unknown → off → on), the same value again, a value sent while
 * a start is still on its way. Every value re-applies the settings, so a tracker that did not start is started again.
 */
export function createTrackingControl(deps: {
  tracker: TrackerLike
  readSettings: () => ExperimentalSettings
  setScreenshotsOverride: (folder: string) => void
  /** The tracking went off: the last position must go from the maps and the phone. */
  onOff: () => void
}) {
  let appliedDir: string | null = null
  let wasOn = false

  /** Returns whether the position tracking is on now. */
  function apply(settings: ExperimentalSettings) {
    // Another folder picked by hand: followed from a fresh start.
    if (appliedDir !== null && appliedDir !== settings.screenshotsDir) deps.tracker.stop()
    appliedDir = settings.screenshotsDir
    deps.setScreenshotsOverride(settings.screenshotsDir)
    // «Отключить местоположение» or the owner's switch: nothing watches the screenshots folder for a position.
    const on = settings.tracking && trackingOn(settings)
    if (on) void Promise.resolve(deps.tracker.start()).catch(() => {})
    else deps.tracker.stop()
    if (wasOn && !on) deps.onOff()
    wasOn = on
    return on
  }

  /** The owner's switch as the server answered; returns whether the tracking is on now. */
  function setRemote(enabled: boolean) {
    if (remoteMinimapOn() !== enabled) setRemoteMinimap(enabled)
    return apply(deps.readSettings())
  }

  return { apply, setRemote }
}
