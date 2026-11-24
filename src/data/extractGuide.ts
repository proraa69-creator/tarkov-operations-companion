import guide from './extractGuide.json'
import { guidePhotoUrl } from './guidePhotoUrl'
import { SCAV_TWIN_SUFFIX } from '../domain/mapLayers'

/**
 * What the map says about an exit (owner, 04.11.2026: «добавь всю информацию и этаж … проверь все выходы что бы была такая
 * информация везде … можешь найти на ресурсах фото выходов и добавить. Источники где взяли не пиши»), by marker id, from
 * scripts/extract-guide.mjs. The players' apps take the pictures from our server, which keeps a copy of every listed file
 * (server/src/services/guideImages.ts). An exit not listed keeps what the catalog says about it.
 */
export interface ExtractGuide {
  ru: string
  en: string
  /** Only where the place differs from the floor the map's heights give. */
  floor?: { ru: string; en: string }
  photos?: string[]
}

const data = guide as unknown as { exits: Record<string, ExtractGuide>; files: Record<string, { file: string; url?: string }> }

/** The Scavs' mark of an exit both sides share has the exit's own text, floor and photo. */
const guideKey = (markerId: string) => (markerId.endsWith(SCAV_TWIN_SUFFIX) ? markerId.slice(0, -SCAV_TWIN_SUFFIX.length) : markerId)

/** Each side has its own mark now, which says whose it is: the text no longer says «for both» (owner, 06.11.2026). */
const BOTH_SIDES = /\s*(?:Для ЧВК и Диких\.|For PMCs and Scavs\.)/g

export function extractGuideOf(markerId: string): ExtractGuide | undefined {
  const entry = data.exits[guideKey(markerId)]
  return entry && { ...entry, ru: entry.ru.replace(BOTH_SIDES, '').trim(), en: entry.en.replace(BOTH_SIDES, '').trim() }
}

/** The exit's floor in words, when the walkthrough says better than the heights. */
export function extractFloor(markerId: string, locale: 'ru' | 'en') {
  return data.exits[guideKey(markerId)]?.floor?.[locale]
}

/** Our server's copy of a photo; '' for one not listed. */
export function extractPhotoUrl(id: string, thumb: boolean) {
  const file = data.files[id]
  if (!file) return ''
  return guidePhotoUrl(id, file.file, thumb)
}
