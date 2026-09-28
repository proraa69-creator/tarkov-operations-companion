/** Schematic module layout, not surveyed game-world coordinates. */
export const HIDEOUT_LAYOUT: Record<string, { x: number; y: number }> = {
  'security': { x: 12, y: 8 },
  'vents': { x: 35, y: 8 },
  'heating': { x: 65, y: 8 },
  'generator': { x: 88, y: 8 },
  'lavatory': { x: 12, y: 22 },
  'water-collector': { x: 35, y: 22 },
  'nutrition-unit': { x: 65, y: 22 },
  'booze-generator': { x: 88, y: 22 },
  'medstation': { x: 12, y: 36 },
  'rest-space': { x: 35, y: 36 },
  'library': { x: 65, y: 36 },
  'intelligence-center': { x: 88, y: 36 },
  'workbench': { x: 12, y: 50 },
  'weapon-rack': { x: 35, y: 50 },
  'gear-rack': { x: 65, y: 50 },
  'shooting-range': { x: 88, y: 50 },
  'stash': { x: 12, y: 64 },
  'scav-case': { x: 35, y: 64 },
  'bitcoin-farm': { x: 65, y: 64 },
  'air-filtering-unit': { x: 88, y: 64 },
  'illumination': { x: 12, y: 78 },
  'hall-of-fame': { x: 35, y: 78 },
  'defective-wall': { x: 65, y: 78 },
  'gym': { x: 88, y: 78 },
  'cultist-circle': { x: 12, y: 92 },
  'solar-power': { x: 35, y: 92 },
}
export function hideoutPosition(normalizedName: string, index: number) {
  return HIDEOUT_LAYOUT[normalizedName] ?? { x: 12 + (index % 4) * 25, y: 8 + Math.floor(index / 4) * 14 }
}
