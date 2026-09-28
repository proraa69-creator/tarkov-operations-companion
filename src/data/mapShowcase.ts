const WIKI = 'https://static.wikia.nocookie.net/escapefromtarkov_gamepedia/images'

export interface MapShowcaseShot {
  mapId: string
  url: string
}

/**
 * "Showcase" screenshots from the official EFT wiki (escapefromtarkov.fandom.com), 1280px thumbnails.
 * Each URL was checked to return HTTP 200 with an image payload.
 */
export const MAP_SHOWCASE: MapShowcaseShot[] = [
  { mapId: 'customs', url: `${WIKI}/6/67/Customs_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20250316152159` },
  { mapId: 'customs', url: `${WIKI}/b/ba/Customs_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20250316152404` },
  { mapId: 'factory', url: `${WIKI}/f/f1/Factory_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20240825122753` },
  { mapId: 'factory', url: `${WIKI}/8/8b/Factory_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20240825122758` },
  { mapId: 'woods', url: `${WIKI}/4/46/Woods_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730012947` },
  { mapId: 'woods', url: `${WIKI}/0/00/Woods_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20230730012949` },
  { mapId: 'shoreline', url: `${WIKI}/d/dc/Shoreline_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730014748` },
  { mapId: 'shoreline', url: `${WIKI}/d/dd/Shoreline_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20230730014750` },
  { mapId: 'interchange', url: `${WIKI}/7/7d/Interchange_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730021446` },
  { mapId: 'interchange', url: `${WIKI}/5/50/Interchange_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20230730021448` },
  { mapId: 'the-lab', url: `${WIKI}/5/5e/The_Lab_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730023546` },
  { mapId: 'reserve', url: `${WIKI}/0/02/Reserve_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730025742` },
  { mapId: 'reserve', url: `${WIKI}/6/69/Reserve_Showcase_10.png/revision/latest/scale-to-width-down/1280?cb=20230730025801` },
  { mapId: 'lighthouse', url: `${WIKI}/2/2e/Lighthouse_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230730032105` },
  { mapId: 'lighthouse', url: `${WIKI}/7/7b/Lighthouse_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20230730032106` },
  { mapId: 'streets-of-tarkov', url: `${WIKI}/c/c1/Streets_of_Tarkov_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20230903143522` },
  { mapId: 'streets-of-tarkov', url: `${WIKI}/c/c3/Streets_of_Tarkov_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20230730042239` },
  { mapId: 'ground-zero', url: `${WIKI}/b/bc/Ground_Zero_Showcase_1.png/revision/latest/scale-to-width-down/1280?cb=20240121131611` },
  { mapId: 'ground-zero', url: `${WIKI}/e/e5/Ground_Zero_Showcase_2.png/revision/latest/scale-to-width-down/1280?cb=20240121131613` },
  { mapId: 'terminal', url: `${WIKI}/c/c0/Terminal_Showcase_1.jpg/revision/latest?cb=20240826021257` },
]

/** Interleaves maps so consecutive slides show different locations, starting with `firstMapId` when possible. */
export function showcaseOrder(firstMapId?: string): MapShowcaseShot[] {
  const byMap = new Map<string, MapShowcaseShot[]>()
  for (const shot of MAP_SHOWCASE) byMap.set(shot.mapId, [...(byMap.get(shot.mapId) ?? []), shot])
  const mapIds = [...byMap.keys()]
  if (firstMapId && byMap.has(firstMapId)) mapIds.sort((a, b) => Number(b === firstMapId) - Number(a === firstMapId))
  const result: MapShowcaseShot[] = []
  for (let round = 0; result.length < MAP_SHOWCASE.length; round += 1) {
    for (const id of mapIds) {
      const shot = byMap.get(id)?.[round]
      if (shot) result.push(shot)
    }
  }
  return result
}
