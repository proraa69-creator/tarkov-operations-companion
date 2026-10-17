/**
 * The browser's own notice that a ResizeObserver callback changed the layout again within one frame: harmless, the
 * observer simply runs on the next frame. It reaches window «error» in Chromium and must never stop the app (owner,
 * 15.10.2026: the recovery screen replaced the running app with «ResizeObserver loop completed…»).
 */
export function isBenignWindowError(message: unknown) {
  const text = message instanceof Error ? message.message : String(message ?? '')
  return /ResizeObserver loop/i.test(text)
}
