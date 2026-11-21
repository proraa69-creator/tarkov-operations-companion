/**
 * The app's stylesheets under one font scale (src/theme/fontSize.ts, «Размер шрифта»): a PostCSS step of the app's build that turns
 * every px of a `font-size` (and of a `line-height` given in px, so lines keep their spacing) into `calc(<px> * var(--font-scale, 1))`,
 * and the size of a `font` shorthand the same way. Without the variable set the scale is 1: the standard size is the very same.
 * Sizes in em, %, vw or container units are left as they are (an em follows its scaled parent).
 */
const PX = /(-?\d*\.?\d+)px/g
const SCALED = 'var(--font-scale, 1)'

export function scaleFontValue(value: string) {
  return value.includes('--font-scale') ? value : value.replace(PX, (_, number: string) => `calc(${number}px * ${SCALED})`)
}

/** The size of a `font` shorthand (`800 12px/1.2 Inter, sans-serif`) and its line height when given in px. */
export function scaleFontShorthand(value: string) {
  if (value.includes('--font-scale')) return value
  return value.replace(/(^|\s)(\d*\.?\d+)px(?:\/(\d*\.?\d+)(px)?)?(?=\s|$)/, (_, before: string, size: string, line?: string, linePx?: string) =>
    `${before}calc(${size}px * ${SCALED})${line ? `/${linePx ? `calc(${line}px * ${SCALED})` : line}` : ''}`)
}

interface Declaration { prop: string; value: string }

export function fontScaleCss() {
  return {
    postcssPlugin: 'raidos-font-scale',
    Declaration(decl: Declaration) {
      if (!decl.value.includes('px')) return
      if (decl.prop === 'font-size' || decl.prop === 'line-height') decl.value = scaleFontValue(decl.value)
      else if (decl.prop === 'font') decl.value = scaleFontShorthand(decl.value)
    },
  }
}
