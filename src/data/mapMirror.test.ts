import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithMirror, mirroredMapUrl, primaryMapUrl, retryTileFromMirror, setMapMirrorServer, upstreamMapUrl } from './mapMirror'

afterEach(() => { setMapMirrorServer(undefined); vi.unstubAllGlobals() })

describe('Raid OS map mirror first', () => {
  const upstream = 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png'
  const mirrored = 'https://raidos.app/v1/map-tiles/maps/customs/main/{z}/{x}/{y}.png'

  it('maps only safe Tarkov map assets in both directions', () => {
    expect(mirroredMapUrl(upstream)).toBe(mirrored)
    expect(primaryMapUrl(upstream)).toBe(mirrored)
    expect(upstreamMapUrl(mirrored)).toBe(upstream)
    expect(mirroredMapUrl('https://assets.tarkov.dev/../secret')).toBeUndefined()
  })

  it('fetches Raid OS first and upstream only after a mirror failure', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response('', { status: calls.length === 1 ? 404 : 200 }) }))
    expect((await fetchWithMirror(upstream)).ok).toBe(true)
    expect(calls).toEqual([mirrored, upstream])
  })

  it('retries a failed mirrored tile from upstream once', () => {
    const tile = { src: mirrored, dataset: {} } as unknown as HTMLImageElement
    retryTileFromMirror({ tile })
    expect(tile.src).toBe(upstream)
    retryTileFromMirror({ tile })
    expect(tile.src).toBe(upstream)
  })
})
