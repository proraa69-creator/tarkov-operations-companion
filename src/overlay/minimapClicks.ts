/**
 * Click-through state of the minimap overlay window (pure logic, driven by electron/experimental/index.ts).
 *
 * The overlay ignores the mouse (clicks go to the game) except while the cursor is over one of its controls:
 * the header, the opacity slider, the map and the quest list. The main process checks the cursor every 50 ms
 * and calls `stepMinimapClicks`; the answer says whether the window must start or stop catching the mouse.
 *
 * Robustness rules (the minimap used to stop reacting to clicks after Alt+Tab, minimizing the game or
 * leaving the inventory):
 * - the state survives the window being hidden or minimized: after it shows again the state is re-applied;
 * - `forgetApplied` (window shown or restored, game in front again, display change) forces a re-apply;
 * - the state is re-applied every REAPPLY_MS anyway, so a window style changed behind our back heals itself;
 * - a press over a control keeps the window catching the mouse only until the button is up, or HOLD_MAX_MS.
 */

export interface ClickZone { x: number; y: number; width: number; height: number }

export const HOLD_MAX_MS = 8_000
export const REAPPLY_MS = 1_000
/** A release seen sooner than this after the press is the press itself still settling. */
const RELEASE_MIN_MS = 150

export interface MinimapClickState {
  /** What the window was last told: true = catches the mouse, false = click-through, null = unknown (apply again). */
  applied: boolean | null
  appliedAt: number
  /** When the left button went down over a control; 0 = not pressed. */
  heldAt: number
  /** Whether the window was visible at the previous step. */
  visible: boolean
}

export interface MinimapClickTick {
  now: number
  /** The window is shown and not minimized. */
  visible: boolean
  /** Cursor position relative to the window's top-left corner. */
  cursor: { x: number; y: number }
  zones: ClickZone[]
  /** The window is being moved by its header: it keeps the mouse. */
  dragging: boolean
  /** Left mouse button state when Windows lets the app read it; null = unknown (an elevated game hides it). */
  buttonDown: boolean | null
}

export interface MinimapClickStep {
  /** New state for the window: true = catch the mouse, false = click-through, null = leave as it is. */
  interactive: boolean | null
  /** The page may still think the button is down: send it a mouse-up. */
  releaseHold: boolean
}

export function initialMinimapClicks(): MinimapClickState {
  return { applied: null, appliedAt: 0, heldAt: 0, visible: false }
}

/** Something outside may have changed the window (shown again, game in front, display change): apply the state again. */
export function forgetApplied(state: MinimapClickState) {
  state.applied = null
}

/** The page reports a press (true) or release (false) over one of its controls. */
export function noteHold(state: MinimapClickState, held: boolean, now: number) {
  state.heldAt = held ? Math.max(1, now) : 0
}

/** The window was told to catch the mouse (true) or ignore it (false) by another path. */
export function noteApplied(state: MinimapClickState, interactive: boolean, now: number) {
  state.applied = interactive
  state.appliedAt = now
}

export function isOverZone(zones: ClickZone[], point: { x: number; y: number }) {
  return zones.some((zone) => point.x >= zone.x && point.x <= zone.x + zone.width && point.y >= zone.y && point.y <= zone.y + zone.height)
}

function apply(state: MinimapClickState, interactive: boolean, now: number, releaseHold = false): MinimapClickStep {
  state.applied = interactive
  state.appliedAt = now
  return { interactive, releaseHold }
}

export function stepMinimapClicks(state: MinimapClickState, tick: MinimapClickTick): MinimapClickStep {
  if (!tick.visible) {
    // Hidden or minimized: nothing to hit-test, but the window must be set up again once it shows.
    const releaseHold = state.heldAt > 0
    state.visible = false
    state.applied = null
    state.heldAt = 0
    return { interactive: null, releaseHold }
  }
  if (!state.visible) {
    state.visible = true
    state.applied = null
  }
  // A drag by the header or a press on a control: the window keeps the mouse until the button is released,
  // or the release would go to the game and the page would think the button is still down.
  if (tick.dragging) return state.applied === true ? { interactive: null, releaseHold: false } : apply(state, true, tick.now)
  let releaseHold = false
  if (state.heldAt) {
    const age = tick.now - state.heldAt
    const released = (tick.buttonDown === false && age > RELEASE_MIN_MS) || age >= HOLD_MAX_MS
    if (!released) return state.applied === true ? { interactive: null, releaseHold: false } : apply(state, true, tick.now)
    state.heldAt = 0
    releaseHold = true
  }
  const over = isOverZone(tick.zones, tick.cursor)
  if (state.applied !== over || tick.now - state.appliedAt >= REAPPLY_MS) return apply(state, over, tick.now, releaseHold)
  return { interactive: null, releaseHold }
}
