// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { bringToFront, startedByTheApp, waitForInstanceLock } from './singleInstance'

function fakeWindow(state: { minimized?: boolean; destroyed?: boolean } = {}) {
  return {
    isDestroyed: () => state.destroyed === true,
    isMinimized: () => state.minimized === true,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  }
}

describe('one copy of the app at a time', () => {
  it('tells a copy the app started itself from one the player started', () => {
    expect(startedByTheApp(['Raid OS.exe'])).toBe(false)
    expect(startedByTheApp(['Raid OS.exe', '--remote-debugging-port=9222', 'C:\\x.html'])).toBe(false)
    expect(startedByTheApp(['Raid OS.exe', '--elevated-relaunch=4242'])).toBe(true)
    expect(startedByTheApp(['Raid OS.exe', '--elevated-relaunch'])).toBe(true)
    expect(startedByTheApp(['Raid OS.exe', '--updated', '--force-run'])).toBe(true)
    expect(startedByTheApp(['Raid OS Server.exe', '--server-mode'])).toBe(true)
    // Only the whole switch: a look-alike is a second start like any other.
    expect(startedByTheApp(['Raid OS.exe', '--elevated-relaunch-please'])).toBe(false)
  })

  it('takes a free lock at the first try', async () => {
    const request = vi.fn(() => true)
    await expect(waitForInstanceLock(request, 50, 1)).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('waits for the copy that is leaving', async () => {
    const request = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValue(true)
    await expect(waitForInstanceLock(request, 1000, 1)).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('gives up on a copy that stays', async () => {
    const request = vi.fn(() => false)
    await expect(waitForInstanceLock(request, 5, 1)).resolves.toBe(false)
    expect(request.mock.calls.length).toBeGreaterThan(1)
  })

  it('brings a minimized window forward', () => {
    const window = fakeWindow({ minimized: true })
    bringToFront(window)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('brings an open window forward without restoring it', () => {
    const window = fakeWindow()
    bringToFront(window)
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('does nothing while there is no window yet, or after it closed', () => {
    expect(() => bringToFront(null)).not.toThrow()
    const closed = fakeWindow({ destroyed: true })
    bringToFront(closed)
    expect(closed.show).not.toHaveBeenCalled()
  })
})
