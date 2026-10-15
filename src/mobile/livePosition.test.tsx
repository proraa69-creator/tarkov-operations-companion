import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveState, ServerPosition } from '../sync/serverSync'

const mocks = vi.hoisted(() => ({ live: vi.fn(), stored: vi.fn() }))
vi.mock('../sync/serverSync', () => ({ fetchLiveState: mocks.live, fetchServerPosition: mocks.stored, POSITION_POLL_MS: 3000 }))
const { useServerPositionPoll } = await import('./livePosition')
const { recognisedItem, resetRecognisedItemForTests } = await import('../items/recognisedItem')

const position = (x: number, at: number): ServerPosition => ({ x, y: 0, z: 5, yaw: 90, at, map: 'customs' })
/** A wait the server answers when the test says so (the PC publishing). */
function pending() {
  let answer!: (state: LiveState | null) => void
  const promise = new Promise<LiveState | null>((resolve) => { answer = resolve })
  return { promise, answer }
}

// Past the scripted answers the relay just keeps the phone waiting.
beforeEach(() => { mocks.live.mockReset(); mocks.live.mockReturnValue(new Promise(() => {})); mocks.stored.mockReset(); resetRecognisedItemForTests() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('the phone\'s position and item card, pushed (owner, 15.10.2026: «моментальное местоположение в мобильном приложении»)', () => {
  it('updates as soon as the relay answers a wait: position and item card, then waits again with the new version', async () => {
    const first = pending()
    const second = pending()
    const third = pending()
    mocks.live.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    const { result } = renderHook(() => useServerPositionPoll('pvp'))
    expect(mocks.live).toHaveBeenLastCalledWith('pvp', undefined)
    await act(async () => { first.answer({ version: 7, position: null, item: null }) })
    await waitFor(() => expect(mocks.live).toHaveBeenLastCalledWith('pvp', 7))
    expect(result.current.push).toBe(true)

    // The PC publishes a position and an item: the waiting phone gets both at once.
    const item = { at: 1234, payload: { state: 'found' as const, itemId: 'gpu', name: 'Видеокарта', shortName: 'GPU', quests: [], kappa: false, collector: false } }
    await act(async () => { second.answer({ version: 8, position: position(42, 2000), item }) })
    await waitFor(() => expect(result.current.position?.x).toBe(42))
    expect(recognisedItem()).toMatchObject({ from: 'server', mode: 'pvp', at: 1234, payload: { name: 'Видеокарта' } })
    expect(mocks.live).toHaveBeenLastCalledWith('pvp', 8)
    expect(mocks.stored).not.toHaveBeenCalled()
  })

  it('falls back to polling the stored position while the push channel is down, and goes back to it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const back = pending()
    mocks.live.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockReturnValueOnce(back.promise)
    mocks.stored.mockResolvedValueOnce(position(1, 100)).mockResolvedValueOnce(position(2, 200))
    const { result } = renderHook(() => useServerPositionPoll('pve', 3000))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.push).toBe(false)
    expect(result.current.position?.x).toBe(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(mocks.stored).toHaveBeenCalledTimes(2)
    expect(result.current.position?.x).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(mocks.live).toHaveBeenCalledTimes(3)
    await act(async () => { back.answer({ version: 1, position: position(3, 300), item: null }) })
    expect(result.current.push).toBe(true)
    expect(result.current.position?.x).toBe(3)
  })
})
