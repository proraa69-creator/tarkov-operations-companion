import { describe, expect, it } from 'vitest'
import { forgetApplied, HOLD_MAX_MS, initialMinimapClicks, noteHold, REAPPLY_MS, stepMinimapClicks, type MinimapClickTick } from './minimapClicks'

const zones = [{ x: 0, y: 0, width: 400, height: 30 }, { x: 0, y: 30, width: 400, height: 300 }]
const over = { x: 100, y: 100 }
const outside = { x: 600, y: 100 }

function tick(now: number, patch: Partial<MinimapClickTick> = {}): MinimapClickTick {
  return { now, visible: true, cursor: outside, zones, dragging: false, buttonDown: null, ...patch }
}

describe('minimap click-through state', () => {
  it('catches the mouse only over a control', () => {
    const state = initialMinimapClicks()
    expect(stepMinimapClicks(state, tick(0)).interactive).toBe(false)
    expect(stepMinimapClicks(state, tick(50)).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(100, { cursor: over })).interactive).toBe(true)
    expect(stepMinimapClicks(state, tick(150, { cursor: over })).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(200)).interactive).toBe(false)
  })

  it('applies the state again after the window was hidden or minimized', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    // Alt+Tab / minimize: the window is not visible for a while.
    expect(stepMinimapClicks(state, tick(50, { visible: false })).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(100, { visible: false, cursor: outside })).interactive).toBeNull()
    // Shown again with the cursor over the map: the window must catch the mouse even though it "was" interactive.
    expect(stepMinimapClicks(state, tick(150, { cursor: over })).interactive).toBe(true)
  })

  it('keeps working after being hidden for a long time (the loop is not stopped by a hidden window)', () => {
    const state = initialMinimapClicks()
    for (let now = 0; now < 60_000; now += 50) stepMinimapClicks(state, tick(now, { visible: false }))
    expect(stepMinimapClicks(state, tick(60_000, { cursor: over })).interactive).toBe(true)
  })

  it('re-applies when told something outside changed the window', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0))
    expect(stepMinimapClicks(state, tick(50)).interactive).toBeNull()
    forgetApplied(state) // the game came to the front again / display changed
    expect(stepMinimapClicks(state, tick(100)).interactive).toBe(false)
  })

  it('re-applies periodically even when nothing seems to change', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    expect(stepMinimapClicks(state, tick(REAPPLY_MS - 50, { cursor: over })).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(REAPPLY_MS, { cursor: over })).interactive).toBe(true)
  })

  it('keeps the mouse while a button is held, then releases it when the button is up', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    noteHold(state, true, 10)
    // The cursor slides off the control while dragging the slider: the window keeps the mouse.
    expect(stepMinimapClicks(state, tick(100, { buttonDown: true })).interactive).toBeNull()
    const released = stepMinimapClicks(state, tick(400, { buttonDown: false }))
    expect(released).toEqual({ interactive: false, releaseHold: true })
    expect(state.heldAt).toBe(0)
  })

  it('never stays held forever when the release cannot be seen (elevated game)', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    noteHold(state, true, 1)
    expect(stepMinimapClicks(state, tick(HOLD_MAX_MS - 49)).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(HOLD_MAX_MS + 1))).toEqual({ interactive: false, releaseHold: true })
  })

  it('drops a press when the window is hidden, so it is not stuck after showing again', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    noteHold(state, true, 1)
    expect(stepMinimapClicks(state, tick(50, { visible: false })).releaseHold).toBe(true)
    expect(stepMinimapClicks(state, tick(100)).interactive).toBe(false)
  })

  it('catches the mouse while held even after a forced re-apply', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0, { cursor: over }))
    noteHold(state, true, 1)
    forgetApplied(state)
    expect(stepMinimapClicks(state, tick(50, { buttonDown: true })).interactive).toBe(true)
  })

  it('keeps the mouse while the window is dragged by its header', () => {
    const state = initialMinimapClicks()
    stepMinimapClicks(state, tick(0))
    expect(stepMinimapClicks(state, tick(50, { dragging: true })).interactive).toBe(true)
    expect(stepMinimapClicks(state, tick(100, { dragging: true })).interactive).toBeNull()
    expect(stepMinimapClicks(state, tick(150)).interactive).toBe(false)
  })
})
