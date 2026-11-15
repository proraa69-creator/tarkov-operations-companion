import { describe, expect, it } from 'vitest'
import { scopeSiteCss } from './scopeSiteCss'

/** The website's sheets inside the PC owner app's «Сводка» (vite.config.ts): scoped, keyframes renamed and kept outside. */
describe('scopeSiteCss', () => {
  it('scopes the rules and moves the keyframes out under a site- name', () => {
    const css = `.button { color: red; }\n@keyframes spin { to { transform: rotate(360deg); } }\n.spinner { animation: spin 1s linear infinite; }\n.spinner-big { animation-name: spin; }\n@media (width <= 720px) { .button { color: blue; } }\n`
    const out = scopeSiteCss(css, ['spin', 'rise'])
    const scope = out.indexOf('@scope (.site-admin, .site-admin-layer) {')
    expect(scope).toBeGreaterThan(0)
    expect(out.indexOf('@keyframes site-spin { to { transform: rotate(360deg); } }')).toBeLessThan(scope)
    expect(out.slice(scope)).not.toContain('@keyframes')
    expect(out).toContain('.spinner { animation: site-spin 1s linear infinite; }')
    expect(out).toContain('.spinner-big { animation-name: site-spin; }')
    expect(out).toContain('.spinner { animation')
    expect(out.slice(scope)).toContain('@media (width <= 720px) { .button { color: blue; } }')
    expect(out.trimEnd().endsWith('}')).toBe(true)
  })

  it('runs the keyframes of another sheet renamed too, and leaves other words alone', () => {
    const out = scopeSiteCss('.card { animation: rise .3s ease; }\n.rise-label { color: var(--rise); }\n', ['rise'])
    expect(out).toContain('animation: site-rise .3s ease;')
    expect(out).toContain('.rise-label { color: var(--rise); }')
  })
})
