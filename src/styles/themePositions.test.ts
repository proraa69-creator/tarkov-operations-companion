import { describe, expect, it } from 'vitest'

/**
 * A theme's anchor for its decorations must not beat a place the page gives a button: in «Кровавая луна»
 * `position: relative` took «Нашли неточность?» out of its corner, it became a cell of the quest window's grid and squeezed
 * the quest's text into a thin column (a player's screenshot, 05.11.2026). Such a rule goes inside :where(), without weight.
 */
const themes = import.meta.glob<string>('./theme*.css', { query: '?raw', import: 'default', eager: true })

function rulesThatPosition(css: string) {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)
  return [...rules].filter(([, , body]) => /(^|[;\s])position\s*:/.test(body!))
    .flatMap(([, selector]) => selector!.split(',').map((entry) => entry.trim()))
    .filter((selector) => /\.button(:not\([^)]*\))?$/.test(selector) && !selector.startsWith(':where('))
}

describe('themes', () => {
  it('finds the theme files', () => {
    expect(Object.keys(themes).length).toBeGreaterThan(2)
    expect(Object.keys(themes)).toContain('./theme-bloodmoon.css')
  })

  it.each(Object.entries(themes))('%s positions no button with weight', (_name, css) => {
    expect(rulesThatPosition(css)).toEqual([])
  })

  it('the check itself sees such a rule', () => {
    expect(rulesThatPosition(':root[data-theme="x"] .button:not(.primary) { position: relative; }')).toHaveLength(1)
    expect(rulesThatPosition(':where(:root[data-theme="x"] .button:not(.primary)) { position: relative; }')).toEqual([])
  })
})
