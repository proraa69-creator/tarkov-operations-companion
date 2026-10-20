import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLivePlayer } from './LivePlayerMarker'
import { LivePositionContext, type LivePositionValue } from '../mobile/livePosition'
import type { RaidState } from '../import/raidState'
import type { PlayerPosition } from '../overlay/screenshotPosition'
import { reloadRemoteFeaturesForTests, setRemoteFeatures } from '../announcement/features'

/** The Labs screenshot of src/overlay/screenshotPosition.test.ts, taken at `at`. */
const labsShot = (at: number): PlayerPosition => ({ x: -230.88, y: 3.59, z: -375.83, yaw: 0, at })

/** The desktop bridge: the stored last position (answered on demand) and the raid state from the logs. */
function desktopBridge(stored: PlayerPosition, raid: RaidState) {
  let sendScreenshot: (position: PlayerPosition | null) => void = () => {}
  let answerStatus: () => void = () => {}
  let raidChanged: (raid: RaidState) => void = () => {}
  const status = new Promise<{ lastPosition: PlayerPosition }>((resolve) => { answerStatus = () => resolve({ lastPosition: stored }) })
  window.tarkovDesktop = {
    getRaidState: async () => raid,
    onRaidStateChanged: (callback: (raid: RaidState) => void) => { raidChanged = callback; return () => {} },
    experimental: {
      getStatus: () => status,
      onPosition: (callback: (position: PlayerPosition | null) => void) => { sendScreenshot = callback; return () => {} },
    },
  } as unknown as NonNullable<Window['tarkovDesktop']>
  return { screenshot: (position: PlayerPosition | null) => sendScreenshot(position), answerStatus: () => answerStatus(), raid: (next: RaidState) => raidChanged(next) }
}

/** The Labs bounds of the catalog (src/data/demo.ts): [[x, z], [x, z]]. */
const LABS_BOUNDS: [[number, number], [number, number]] = [[-80, -477], [-287, -193]]

// The owner keeps the position on for everybody (src/announcement/features.ts) unless a test turns it off.
beforeEach(() => setRemoteFeatures({ minimap: true, minimapChangedAt: '' }))
afterEach(() => { delete window.tarkovDesktop; localStorage.clear(); reloadRemoteFeaturesForTests() })

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

describe('the dot when the game\'s logs name no map (the minimap over the game used the open map; «Карты» lost that on 15.10.2026)', () => {
  it('desktop: a fresh screenshot with no raid map in the logs is drawn on the open map when its coordinates fit it', async () => {
    const bridge = desktopBridge(labsShot(Date.now() - 60_000), { inRaid: false })
    const { result, rerender } = renderHook(({ mapId, bounds }) => useLivePlayer(mapId, bounds), { initialProps: { mapId: 'the-lab', bounds: LABS_BOUNDS as typeof LABS_BOUNDS | undefined } })
    await act(async () => bridge.answerStatus())
    await waitFor(() => expect(result.current).toMatchObject({ source: 'desktop', onThisMap: true, guessed: true, reason: 'shown-map' }))
    // A new screenshot (PrtSc in the raid) moves it at once.
    act(() => bridge.screenshot({ ...labsShot(Date.now()), x: -200 }))
    expect(result.current.position?.x).toBe(-200)
    expect(result.current.onThisMap).toBe(true)
    // Coordinates far off the open map (a small map such as Factory): not drawn there.
    rerender({ mapId: 'factory', bounds: [[-64, -58], [74, 62]] })
    expect(result.current).toMatchObject({ onThisMap: false, reason: 'off-map' })
  })

  it('desktop: in a raid whose location the logs do not name, the open map too', async () => {
    const bridge = desktopBridge(labsShot(Date.now()), { inRaid: true, since: Date.now() - 60_000 })
    const { result } = renderHook(() => useLivePlayer('the-lab', LABS_BOUNDS))
    await act(async () => bridge.answerStatus())
    await waitFor(() => expect(result.current).toMatchObject({ onThisMap: true, guessed: true }))
  })

  it('desktop: logs followed, raid on, its map not named yet — no dot on the open map; the next screenshot reads the map anew (owner, 20.10.2026)', async () => {
    const raid: RaidState = { inRaid: true, since: Date.now() - 60_000, tracked: true }
    const bridge = desktopBridge(labsShot(Date.now()), raid)
    const { result, rerender } = renderHook((mapId: string) => useLivePlayer(mapId, LABS_BOUNDS), { initialProps: 'customs' })
    await act(async () => bridge.answerStatus())
    await waitFor(() => expect(result.current.position).not.toBeNull())
    expect(result.current.onThisMap).toBe(false)
    // The main process read the map meanwhile but did not send it (a main process from before 0.6.0.83).
    raid.location = 'laboratory'
    await act(async () => bridge.screenshot(labsShot(Date.now())))
    rerender('the-lab')
    await waitFor(() => expect(result.current).toMatchObject({ onThisMap: true, guessed: false }))
    rerender('customs')
    expect(result.current.onThisMap).toBe(false)
  })

  it('desktop: an old screenshot, or one from before the raid ended, is not put on the open map', async () => {
    const old = desktopBridge(labsShot(Date.now() - 21 * 60_000), { inRaid: false })
    const { result } = renderHook(() => useLivePlayer('the-lab', LABS_BOUNDS))
    await act(async () => old.answerStatus())
    await waitFor(() => expect(result.current.position).not.toBeNull())
    expect(result.current).toMatchObject({ onThisMap: false, reason: 'stale' })

    const ended = desktopBridge(labsShot(Date.now() - 1000), { inRaid: true, location: 'laboratory', since: Date.now() - 600_000 })
    const second = renderHook(() => useLivePlayer('the-lab', LABS_BOUNDS))
    await act(async () => ended.answerStatus())
    await waitFor(() => expect(second.result.current).toMatchObject({ onThisMap: true, guessed: false, reason: 'raid-map' }))
    act(() => ended.raid({ inRaid: false }))
    expect(second.result.current).toMatchObject({ onThisMap: false, reason: 'after-raid' })
  })

  it('desktop: off for everybody (the owner\'s switch) or the tracking went off: no dot', async () => {
    const bridge = desktopBridge(labsShot(Date.now()), { inRaid: true, location: 'laboratory', since: 1000 })
    const { result } = renderHook(() => useLivePlayer('the-lab', LABS_BOUNDS))
    await act(async () => bridge.answerStatus())
    await waitFor(() => expect(result.current.onThisMap).toBe(true))
    act(() => setRemoteFeatures({ minimap: false, minimapChangedAt: '2026-10-16T10:00:00.000Z' }))
    expect(result.current).toMatchObject({ position: null, onThisMap: false })
    act(() => setRemoteFeatures({ minimap: true, minimapChangedAt: '' }))
    expect(result.current.onThisMap).toBe(true)
    // The main process took the position away (experimental:position null).
    act(() => bridge.screenshot(null))
    expect(result.current).toMatchObject({ position: null, onThisMap: false })
  })

  it('phone: a position the PC could not name a map for is drawn on the open map while fresh', () => {
    const value = (fresh: boolean): LivePositionValue => ({ position: labsShot(Date.now()), fresh, follow: true, setFollow: () => {} })
    let live = value(true)
    const wrapper = ({ children }: { children: ReactNode }) => <LivePositionContext.Provider value={live}>{children}</LivePositionContext.Provider>
    const { result, rerender } = renderHook((mapId: string) => useLivePlayer(mapId, LABS_BOUNDS), { initialProps: 'the-lab', wrapper })
    expect(result.current).toMatchObject({ source: 'server', onThisMap: true, guessed: true })
    live = value(false)
    rerender('the-lab')
    expect(result.current.onThisMap).toBe(false)
  })
})
