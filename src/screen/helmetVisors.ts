import type { GearStats } from '../domain/types'
import type { VisorPosition } from './tierLists'

/** The pictures, `<helmet id>.<down|up>.webp`: drawn by the game's own icon renderer in the offline copy (E:\SPT-photo\helmets). */
const PHOTOS = import.meta.glob<string>('../assets/helmet-visors/*.webp', { eager: true, query: '?url', import: 'default' })

/**
 * The helmets with pictures of their visor down and raised, and the visor in the pictures (owner, 20.11.2026: «сделай скрины под
 * каждый шлем с забралами… маска 1Щ черная или Killa Edition, потом маска 1Щ просто, Рысь Т, Алтын и Вулкан 5. И еще ЛШЗ 2 ДТМ…
 * с забралом, которое подходит для них… только вот эти модели»). Only these have «Опустить забрало» / «Поднять забрало».
 */
export const VISOR_HELMETS: Readonly<Record<string, string>> = {
  '5c0e874186f7745dc7616606': '5c0e842486f77443a74d2976', // Маска-1Щ (Killa Edition), its black visor
  '5c091a4e0db834001d5addc8': '5c0919b50db834001b7ce3b9', // Маска-1Щ (олива), the olive visor
  '5f60c74e3b85f6263c145586': '5f60c85b58eff926626a60f7', // Рысь-Т
  '5aa7e276e5b5b000171d0647': '5aa7e373e5b5b000137b76f0', // Алтын
  '5ca20ee186f774799474abc2': '5ca2113f86f7740b2547e1d2', // Вулкан-5
  '5d6d3716a4b9361bc8618872': '5d6d3829a4b9361bc8618943', // ЛШЗ-2ДТМ
}

/** The helmet's picture with its visor in that position: only when the stats are of the visor in the picture. */
export function visorPhoto(helmetId: string, gear: GearStats | undefined, position: VisorPosition, photos: Readonly<Record<string, string>> = PHOTOS): string | undefined {
  const visorId = VISOR_HELMETS[helmetId]
  if (!visorId || gear?.kind !== 'helmet' || gear.visorId !== visorId || !gear.visor) return undefined
  return photos[`../assets/helmet-visors/${helmetId}.${position}.webp`]
}

/** Whether the helmet's visor can be lowered and raised in «Тир листы»: both pictures are there. */
export function canToggleVisor(helmetId: string, gear: GearStats | undefined, photos: Readonly<Record<string, string>> = PHOTOS) {
  return Boolean(visorPhoto(helmetId, gear, 'down', photos) && visorPhoto(helmetId, gear, 'up', photos))
}
