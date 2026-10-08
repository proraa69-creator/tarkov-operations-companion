import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLivePlayer } from './LivePlayerMarker'
import { LivePositionContext, type LivePositionValue } from '../mobile/livePosition'
import type { RaidState } from '../import/raidState'
import type { PlayerPosition } from '../overlay/screenshotPosition'

/** The Labs screenshot of src/overlay/screenshotPosition.test.ts, taken at `at`. */
const labsShot = (at: number): PlayerPosition => ({ x: -230.88, y: 3.59, z: -375.83, yaw: 0, at })

/** The desktop bridge: the stored last position (answered on demand) and the raid state from the logs. */
function desktopBridge(stored: PlayerPosition, raid: RaidState) {
  let sendScreenshot: (position: PlayerPosition) => void = () => {}
  let answerStatus: () => void = () => {}
  const status = new Promise<{ lastPosition: PlayerPosition }>((resolve) => { answerStatus = () => resolve({ lastPosition: stored }) })
  window.tarkovDesktop = {
    getRaidState: async () => raid,
    onRaidStateChanged: () => () => {},
    experimental: {
      getStatus: () => status,
      onPosition: (callback: (position: PlayerPosition) => void) => { sendScreenshot = callback; return () => {} },
    },
  } as unknown as NonNullable<Window['tarkovDesktop']>
  return { screenshot: (position: PlayerPosition) => sendScreenshot(position), answerStatus: () => answerStatus() }
}

afterEach(() => { delete window.tarkovDesktop })

describe('the player on a map page (moved out of the marker so the page can follow the floor)', () => {
  it('desktop: the screenshot position belongs to the raid map only', async () => {
    const bridge = desktopBridge(labsShot(5000), { inRaid: true, location: 'laboratory', since: 1000 })
    const { result, rerender } = renderHook((mapId: string) => useLivePlayer(mapId), { initialProps: 'the-lab' })
    await act(async () => bridge.answerStatus())
    await waitFor(() => expect(result.current).toMatchObject({ source: 'desktop', onThisMap: true, position: { at: 5000 } }))
    rerender('customs')
    expect(result.current.onThisMap).toBe(false)
  })

  it('desktop: a screenshot from before this raid started is not the player\'s position', async () => {
    const bridge = desktopBridge(labsShot(5000), { inRaid: true, location: 'laboratory', since: 9000 })
    const { result } = renderHook(() => useLivePlayer('the-lab'))
    await act(async () => bridge.answerStatus())
    expect(result.current.position?.at).toBe(5000)
    expect(result.current.onThisMap).toBe(false)
  })

  it('desktop: the stored position answering late does not replace a newer screenshot', async () => {
    const bridge = desktopBridge(labsShot(5000), { inRaid: true, location: 'laboratory', since: 1000 })
    const { result } = renderHook(() => useLivePlayer('the-lab'))
    act(() => bridge.screenshot(labsShot(8000)))
    await act(async () => bridge.answerStatus())
    expect(result.current.position?.at).toBe(8000)
  })

  it('phone: the position from the server counts on its own map', () => {
    const live: LivePositionValue = { position: { ...labsShot(5000), map: 'the-lab' }, fresh: true, follow: true, setFollow: () => {} }
    const wrapper = ({ children }: { children: ReactNode }) => <LivePositionContext.Provider value={live}>{children}</LivePositionContext.Provider>
    const { result, rerender } = renderHook((mapId: string) => useLivePlayer(mapId), { initialProps: 'the-lab', wrapper })
    expect(result.current).toMatchObject({ source: 'server', onThisMap: true, position: { at: 5000 } })
    rerender('customs')
    expect(result.current.onThisMap).toBe(false)
  })
})
