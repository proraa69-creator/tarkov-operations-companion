import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithMirror, mirroredMapUrl, primaryMapUrl, setMapMirrorServer } from './mapMirror'

afterEach(() => { setMapMirrorServer(undefined); vi.unstubAllGlobals() })

describe('Raid OS map mirror first', () => {
  const upstream = 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png'
  const mirrored = 'https://raidos.app/v1/map-tiles/maps/customs/main/{z}/{x}/{y}.png'

  it('maps only safe Tarkov map assets to Raid OS', () => {
    expect(mirroredMapUrl(upstream)).toBe(mirrored)
    expect(primaryMapUrl(upstream)).toBe(mirrored)
    expect(mirroredMapUrl('https://assets.tarkov.dev/../secret')).toBeUndefined()
  })

  it('never retries upstream after a mirror failure', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response('', { status: 404 }) }))
    expect((await fetchWithMirror(upstream)).status).toBe(404)
    expect(calls).toEqual([mirrored])
  })
})
