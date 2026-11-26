import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The free Overview re-packs its blocks on every height change and glides them to their new place itself
 * (useOverviewEditor FLIP). A block whose part opens with a height animated over many frames re-packs the Overview every
 * frame: the block below jumps over the opening part (owner, 25.11.2026: «Блок оружейника при раскладывании опять
 * дергается»; «Текущие задания» earlier the same day). What opens inside an Overview block changes its height in one step
 * and fades in.
 */
const css = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

/** Every declaration block of a selector (its own rules, not ones that only mention it inside a longer selector). */
function rulesOf(source: string, selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [...source.matchAll(new RegExp(`(?:^|[}\\s,])${escaped}(?:\\.is-open)?\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1]!)
}

describe('what opens inside a free Overview block', () => {
  for (const [file, selector] of [['gunsmith/gunsmith.css', '.gunsmith-details'], ['styles/pages.css', '.current-tasks-more']] as const) {
    it(`${selector}: the height in one step, only the opacity animated`, () => {
      const rules = rulesOf(css(file), selector)
      expect(rules.length).toBeGreaterThan(0)
      for (const rule of rules) {
        const transition = /transition\s*:([^;]*)/.exec(rule)?.[1] ?? ''
        expect(transition).not.toMatch(/grid-template-rows|height|all/)
      }
    })
  }
})
