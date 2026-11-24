import { afterEach, describe, expect, it, vi } from 'vitest'
import { adaptMapRenderingConfigs, fetchMapRenderingConfigs, hedgedGet } from './mapConfigClient'

describe('map rendering config adapter', () => {
  it('loads maps.json only from Raid OS', async () => {
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      calls.push(String(input))
      return new Response('unavailable', { status: 503 })
    }) as typeof fetch
    await expect(fetchMapRenderingConfigs(fetcher)).rejects.toThrow('HTTP 503')
    expect(calls).toEqual(['https://raidos.app/v1/map-tiles/maps.json'])
  })

  it('normalizes Tarkov.dev map rendering config', () => {
    const configs = adaptMapRenderingConfigs([{
      normalizedName: 'customs',
      maps: [{
        key: 'customs',
        minZoom: 1,
        maxZoom: 5,
        transform: [0.239, 168.65, 0.239, 136.35],
        coordinateRotation: 180,
        bounds: [[698, -307], [-372, 237]],
        tilePath: 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png',
        layers: [{ name: '2nd Floor', heightRange: [5, 15] }],
      }],
    }])

    expect(configs.get('customs')).toMatchObject({
      tileUrl: 'https://raidos.app/v1/map-tiles/maps/customs/main/{z}/{x}/{y}.png',
      bounds: [[698, -307], [-372, 237]],
      transform: [0.239, 168.65, 0.239, 136.35],
      coordinateRotation: 180,
      floors: ['Основной', '2 этаж'],
    })
  })

  it('keeps floor extents with building bounds and marks floors without own tiles', () => {
    const configs = adaptMapRenderingConfigs([{
      normalizedName: 'customs',
      maps: [{
        key: 'customs',
        tilePath: 'https://assets.tarkov.dev/maps/customs/main/{z}/{x}/{y}.png',
        heightRange: [-1000, 1000],
        layers: [
          { name: '2nd Floor', tilePath: 'https://assets.tarkov.dev/maps/customs/2nd/{z}/{x}/{y}.png', extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125], 'dorms']] }] },
          { name: 'Underground', extents: { height: [-1000, 0.5] } },
        ],
      }],
    }])
    const layers = configs.get('customs')?.layers ?? []
    expect(layers[1]).toMatchObject({ name: '2 этаж', ownTiles: true, extents: [{ height: [2.7, 6.5], bounds: [[[243, 190], [165, 125]]] }] })
    expect(layers[2]).toMatchObject({ name: 'Подземный', ownTiles: false, extents: [{ height: [-1000, 0.5] }] })
  })
})

// 15.11.2026: from a network that loses a new connection's first packet, maps.json took ~20 s and failed at its 20 s limit.
describe('maps.json on a slow way to the server', () => {
  afterEach(() => { vi.useRealTimers() })

  it('sends it again while no copy has answered; the first answer wins and the others stop', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const fetcher = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init!.signal!)
      // the first copy hangs on its connection, the second answers
      return signals.length === 1 ? new Promise<Response>(() => {}) : Promise.resolve(new Response('[]', { status: 200 }))
    }) as unknown as typeof fetch
    const answer = hedgedGet(fetcher, 'https://raidos.app/v1/map-tiles/maps.json', {}, 45_000, [1500, 4000])
    await vi.advanceTimersByTimeAsync(1499)
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect((await answer).status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(signals[0]!.aborted).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails only when every copy failed', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch
    const answer = hedgedGet(fetcher, 'https://raidos.app/v1/map-tiles/maps.json', {}, 45_000, [1500])
    const caught = answer.catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(1600)
    expect(await caught).toBe('offline')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
