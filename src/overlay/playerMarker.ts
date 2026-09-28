export type PlayerMarkerStyle = 'arrow' | 'chevron' | 'dot'

/** SVG for the player's position, rotated to the camera heading (degrees on screen). */
export function playerMarkerSvg(style: PlayerMarkerStyle, angle: number) {
  const rotate = `transform:rotate(${angle.toFixed(1)}deg)`
  if (style === 'dot') {
    return `<svg class="pm pm-dot" viewBox="0 0 40 40" style="${rotate}"><circle cx="20" cy="20" r="14" class="pm-halo"/><path d="M20 4 L25 13 L15 13 Z" class="pm-tip"/><circle cx="20" cy="20" r="7.5" class="pm-core"/></svg>`
  }
  if (style === 'chevron') {
    return `<svg class="pm pm-chevron" viewBox="0 0 40 40" style="${rotate}"><path d="M20 4 L33 33 L20 25 L7 33 Z" class="pm-core"/></svg>`
  }
  // Classic game arrow: a view cone with an arrow head in the middle.
  return `<svg class="pm pm-arrow" viewBox="0 0 40 40" style="${rotate}"><path d="M20 20 L8 1 A22 22 0 0 1 32 1 Z" class="pm-cone"/><path d="M20 8 L29 30 L20 25 L11 30 Z" class="pm-core"/></svg>`
}
