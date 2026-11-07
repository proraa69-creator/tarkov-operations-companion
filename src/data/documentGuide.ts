import { useEffect, useState } from 'react'
import type { BattlePassDocumentKind } from './battlePassDocuments'
import { guidePhotoUrl } from './guidePhotoUrl'

/**
 * The photos of where the battle pass documents spawn (scripts/document-guide-photos.mjs → documentGuidePhotos.json): by map and
 * kind, and which of them show which spot. The players' apps take the pictures from our server (server/src/services/guideImages.ts).
 */
export interface DocumentGuide {
  files: Record<string, { file: string; url: string }>
  photos: Record<string, { kind: BattlePassDocumentKind; ru: string; en: string }>
  maps: Record<string, Partial<Record<BattlePassDocumentKind, string[]>>>
  spots: Record<string, Array<{ x: number; z: number; photos: string[] }>>
}

let loading: Promise<DocumentGuide> | null = null
/** The list is large: loaded once, the first time a document's card or the layer's list asks. */
const loadGuide = () => (loading ??= import('./documentGuidePhotos.json').then((module) => module.default as unknown as DocumentGuide))

export function useDocumentGuide() {
  const [guide, setGuide] = useState<DocumentGuide | null>(null)
  useEffect(() => {
    let live = true
    loadGuide().then((loaded) => { if (live) setGuide(loaded) }, () => {})
    return () => { live = false }
  }, [])
  return guide
}

/** How far a point may stand from a photo's spot: the feed moves a spawn a little between versions, a pin placed by hand more. */
const SPOT_REACH_METRES = 8

/**
 * The photos of a point on the map (`position`: [z, x], as the markers keep it) and of these kinds: for each kind, those of the
 * nearest spot that has that kind within reach. Not a spot further off: rooms on one floor stand a few metres apart.
 */
export function pointPhotos(guide: DocumentGuide | null, mapId: string, position: readonly [number, number], kinds: readonly BattlePassDocumentKind[]): string[] {
  if (!guide) return []
  const found: string[] = []
  for (const kind of kinds) {
    let nearest = SPOT_REACH_METRES
    let photos: string[] = []
    for (const spot of guide.spots[mapId] ?? []) {
      const own = spot.photos.filter((id) => guide.photos[id]?.kind === kind)
      const distance = Math.hypot(spot.z - position[0], spot.x - position[1])
      if (own.length && distance <= nearest) { nearest = distance; photos = own }
    }
    found.push(...photos.filter((id) => !found.includes(id)))
  }
  return found
}

export function documentPhotoUrl(guide: DocumentGuide, id: string, thumb: boolean) {
  return guidePhotoUrl(id, guide.files[id]?.file ?? 'photo.png', thumb)
}
