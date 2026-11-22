import { describe, expect, it } from 'vitest'
import { nextStageWidth } from './stageLayout'

// support chat, 20.11.2026: «интерфейс основной страницы… бегает вверх и вниз (как понимаю оружейник летает)»
describe('the width the build stage is laid out at', () => {
  it('a first measure, a narrower width and a clearly wider one are taken', () => {
    expect(nextStageWidth(0, 652)).toBe(652)
    expect(nextStageWidth(652, 642)).toBe(642)
    expect(nextStageWidth(642, 700)).toBe(700)
  })

  it('a page scrollbar coming and going settles at once instead of laying the stage out again and again', () => {
    // the stage at 652 makes the page taller: the scrollbar comes (642); laid out narrower, the page is shorter: it goes (652) …
    let width = nextStageWidth(0, 652)
    const seen: number[] = []
    for (let step = 0; step < 6; step += 1) {
      width = nextStageWidth(width, step % 2 === 0 ? 642 : 652)
      seen.push(width)
    }
    expect(seen).toEqual([642, 642, 642, 642, 642, 642])
  })
})
