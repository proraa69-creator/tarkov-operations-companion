/**
 * Presses on the minimap were dropped after it had been hidden once (owner, 13.10.2026: «мини карта … не перемещается,
 * не меняется размер, и прозрачность и не нажимаются квесты. то работает то нет … решается … перетаскиванием ползунка
 * размера»).
 *
 * Chromium takes the mouse through a child window («Chrome_RenderWidgetHostHWND») that it hides together with the
 * overlay. The overlays keep drawing while hidden (backgroundThrottling: false), and on that path Electron 44 never
 * shows the child again (its patched RenderWidgetHostViewAura::ShowImpl skips the step that would). Windows then drops
 * every press on a window that cannot be activated: header drag, sliders, quest and floor buttons. Hover and the wheel
 * still work, which is why the window looked alive. The only thing that shows the child again is a change of the
 * window's size (InternalSetBounds → UpdateLegacyWin) — what the size slider did.
 *
 * So after every show and restore the window grows by REATTACH_PX for a moment (transparent space under the map: the
 * page keeps its content at the top) and goes back; the page fits the window back itself as well (useFitWindow).
 */

export interface Bounds { x: number; y: number; width: number; height: number }

/** The part of BrowserWindow this needs. */
export interface SizedWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  getBounds(): Bounds
  setBounds(bounds: Bounds): void
}

export const REATTACH_PX = 2
export const REATTACH_RESTORE_MS = 120

const reattaching = new WeakSet<SizedWindow>()

export const isReattaching = (window: SizedWindow) => reattaching.has(window)

/** One real change of the window's size, put back a moment later (not at once: two sizes in a row can merge into none). */
export function reattachInput(window: SizedWindow, later: (run: () => void, ms: number) => unknown = setTimeout) {
  if (window.isDestroyed() || !window.isVisible() || reattaching.has(window)) return false
  reattaching.add(window)
  const before = window.getBounds()
  window.setBounds({ ...before, height: before.height + REATTACH_PX })
  later(() => {
    reattaching.delete(window)
    if (window.isDestroyed()) return
    const now = window.getBounds()
    // Put back only what this changed: the page or a drag may have sized or moved the window meanwhile.
    if (now.width === before.width && now.height === before.height + REATTACH_PX) window.setBounds({ ...now, height: before.height })
  }, REATTACH_RESTORE_MS)
  return true
}

/** How often the child is looked at while the cursor is on a control. */
export const INPUT_CHECK_MS = 1_000
/** Tries per show: a child that stays hidden after this many is not what drops the presses; stop resizing the window. */
export const INPUT_HEALS_MAX = 3

/**
 * With the cursor on a control: the input window hidden by anything without a show event (a locked screen, the
 * window covered for a while) is shown again. `childVisible` is null when Windows cannot tell; nothing is done then.
 */
export class InputWatch {
  private checkedAt = Number.NEGATIVE_INFINITY
  private heals = 0

  /** Shown or restored: the tries start over. */
  reset() {
    this.heals = 0
  }

  check(window: SizedWindow, now: number, childVisible: () => boolean | null, later?: (run: () => void, ms: number) => unknown) {
    if (now - this.checkedAt < INPUT_CHECK_MS || this.heals >= INPUT_HEALS_MAX || reattaching.has(window)) return false
    this.checkedAt = now
    if (childVisible() !== false) return false
    this.heals += 1
    return reattachInput(window, later)
  }
}
