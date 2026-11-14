import { describe, expect, it } from 'vitest'
import { cleanSquadLive, squadLivePath } from './squadLive'
import { sendablePosition } from './useSquadLocationShare'

const A = 'a'.repeat(24)

describe('the squad\'s places and drawings from the server (owner, 14.11.2026)', () => {
  it('keeps only well-formed mates, positions and strokes', () => {
    const live = cleanSquadLive({
      version: 5,
      positions: [{ memberId: A, x: 1, y: 2, z: 3, yaw: 90, at: 10, map: 'customs' }, { memberId: 'nope', x: 1, y: 2, z: 3, yaw: 0, at: 1 }, { memberId: A, x: 'x' }],
      sketches: [
        { memberId: A, mapId: 'woods', strokes: [{ zoom: 2, points: [[1, 2], [3, 'x'], [5, 6]], color: '#ff2b2b' }, { zoom: 1, points: [] }, { zoom: 1, points: [[0, 0]], color: 'javascript:' }] },
        { memberId: A, mapId: '../x', strokes: [{ zoom: 1, points: [[0, 0]] }] },
      ],
    })
    expect(live).toEqual({
      version: 5,
      positions: [{ memberId: A, x: 1, y: 2, z: 3, yaw: 90, at: 10, map: 'customs' }],
      sketches: [{ memberId: A, mapId: 'woods', strokes: [{ zoom: 2, points: [[1, 2], [5, 6]], color: '#ff2b2b' }, { zoom: 1, points: [[0, 0]] }] }],
    })
    expect(cleanSquadLive({ positions: [] })).toBeNull()
    expect(cleanSquadLive(null)).toBeNull()
  })

  it('the paths the app may call (electron/serviceGateway.ts ROUTES)', () => {
    expect(squadLivePath('b'.repeat(32), 'pve')).toBe(`/v1/squad-live/${'b'.repeat(32)}/pve`)
  })

  it('sends only a position the server takes', () => {
    expect(sendablePosition({ x: 1, y: 2, z: 3, yaw: 45, at: 100 } as never)).toBe(true)
    expect(sendablePosition({ x: 1, y: 2, z: Number.NaN, yaw: 45, at: 100 } as never)).toBe(false)
    expect(sendablePosition({ x: 1, y: 2, z: 3, yaw: 5000, at: 100 } as never)).toBe(false)
  })
})
