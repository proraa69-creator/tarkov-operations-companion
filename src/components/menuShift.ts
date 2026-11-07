/** How far a menu moves to stay on a screen this wide, with a small margin; the left edge first, if it is wider than the screen. */
export function menuShift(left: number, right: number, screen: number, margin = 8) {
  if (left < margin) return margin - left
  if (right > screen - margin) return Math.max(screen - margin - right, margin - left)
  return 0
}
