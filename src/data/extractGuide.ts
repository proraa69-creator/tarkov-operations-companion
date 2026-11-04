import guide from './extractGuide.json'

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

export function extractGuideOf(markerId: string): ExtractGuide | undefined {
  return data.exits[markerId]
}

/** The exit's floor in words, when the walkthrough says better than the heights. */
export function extractFloor(markerId: string, locale: 'ru' | 'en') {
  return data.exits[markerId]?.floor?.[locale]
}

/** Our server's copy of a photo; '' for one not listed. */
export function extractPhotoUrl(id: string, thumb: boolean) {
  const file = data.files[id]
  if (!file) return ''
  const ext = (file.file.split('.').pop() ?? 'png').toLowerCase().replace('jpeg', 'jpg')
  return `https://raidos.app/v1/guide-images/wiki-${id}${thumb ? '-t' : ''}.${ext}`
}
