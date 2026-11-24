import { describe, expect, it } from 'vitest'
import { floorWheelState, wheelDelta } from './mapFloorWheel'

/** A RAWINPUT of the mouse (64-bit layout): header 24 bytes, then usFlags, usButtonFlags, usButtonData. */
function rawMouse(buttonFlags: number, buttonData: number, type = 0) {
  const bytes = new Uint8Array(48)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, type, true)
  view.setUint32(4, 48, true)
  view.setUint16(24 + 4, buttonFlags, true)
  view.setInt16(24 + 6, buttonData, true)
  return bytes
}

describe('Alt + the wheel from the game (owner, 08.11.2026: «не переключаясь из игры, он может перелистать этаж карты»)', () => {
  it('reads the wheel\'s turn from the mouse\'s raw input; anything else is no turn', () => {
    expect(wheelDelta(rawMouse(0x0400, 120))).toBe(120)
    expect(wheelDelta(rawMouse(0x0400, -120))).toBe(-120)
    // a button or a move
    expect(wheelDelta(rawMouse(0x0001, 0))).toBeNull()
    // the keyboard's raw input
    expect(wheelDelta(rawMouse(0x0400, 120, 1))).toBeNull()
    expect(wheelDelta(new Uint8Array(10))).toBeNull()
  })

  it('listens only while Alt is held and the app is not the focused window', () => {
    const state = floorWheelState()
    expect(state.tick({ altDown: true, appFocused: false })).toBe(true)
    expect(state.tick({ altDown: false, appFocused: false })).toBe(false)
    // the app focused: the page reads the wheel itself
    expect(state.tick({ altDown: true, appFocused: true })).toBe(false)
  })

  it('a notch up is the floor above, a notch down the floor below; one flick is one step', () => {
    const state = floorWheelState()
    expect(state.turn(120, 1000)).toBe(1)
    expect(state.turn(120, 1050)).toBeNull()
    expect(state.turn(-120, 1300)).toBe(-1)
    // a touchpad's small turns add up
    expect(state.turn(-30, 1600)).toBeNull()
    expect(state.turn(-40, 1610)).toBe(-1)
  })
})
