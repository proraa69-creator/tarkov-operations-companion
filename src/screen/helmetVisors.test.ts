import { describe, expect, it } from 'vitest'
import type { GearStats } from '../domain/types'
import { canToggleVisor, VISOR_HELMETS, visorPhoto } from './helmetVisors'

const KILLA = '5c0e874186f7745dc7616606'
const KILLA_VISOR = '5c0e842486f77443a74d2976'
const gear = (visorId: string): GearStats => ({ kind: 'helmet', armorClass: 4, faceClass: 6, visorId, visor: { armorClass: 6, speedPenalty: 0, turnPenalty: 0, ergoPenalty: -0.13 } })
const photos = { [`../assets/helmet-visors/${KILLA}.down.webp`]: '/down.webp', [`../assets/helmet-visors/${KILLA}.up.webp`]: '/up.webp' }

// Owner, 20.11.2026: «Маска 1Щ черная или Killa Edition, потом маска 1Щ просто, Рысь Т, Алтын и Вулкан 5. И еще ЛШЗ 2 ДТМ… только вот эти модели».
describe('helmets photographed with their visor down and raised', () => {
  it('are the six of the owner’s list, each with its own visor', () => {
    expect(Object.keys(VISOR_HELMETS)).toHaveLength(6)
    expect(VISOR_HELMETS[KILLA]).toBe(KILLA_VISOR)
  })

  it('show the picture of the position, only with the stats of the visor in it', () => {
    expect(visorPhoto(KILLA, gear(KILLA_VISOR), 'down', photos)).toBe('/down.webp')
    expect(visorPhoto(KILLA, gear(KILLA_VISOR), 'up', photos)).toBe('/up.webp')
    expect(canToggleVisor(KILLA, gear(KILLA_VISOR), photos)).toBe(true)
    // another visor in the stats, no visor stats, another helmet, a missing picture: no toggle
    expect(canToggleVisor(KILLA, gear('5c0919b50db834001b7ce3b9'), photos)).toBe(false)
    expect(canToggleVisor(KILLA, { kind: 'helmet', armorClass: 4, faceClass: 6, visorId: KILLA_VISOR }, photos)).toBe(false)
    expect(canToggleVisor('5ea05cf85ad9772e6624305d', gear(KILLA_VISOR), photos)).toBe(false)
    expect(canToggleVisor(KILLA, gear(KILLA_VISOR), { [`../assets/helmet-visors/${KILLA}.down.webp`]: '/down.webp' })).toBe(false)
  })

  it('have both pictures in the app', () => {
    for (const [helmet, visor] of Object.entries(VISOR_HELMETS)) expect(canToggleVisor(helmet, gear(visor)), helmet).toBe(true)
  })
})
