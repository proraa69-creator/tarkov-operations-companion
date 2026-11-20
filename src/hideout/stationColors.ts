/**
 * Each module's own colour on «Убежище» (owner, 20.11.2026: «иконки, как в самой игре, только они должны быть цветные, раскрашенные»):
 * the mean colour of its painted picture (src/assets/hideout-stations, hideout/stationIcons.ts), by tarkov.dev's normalizedName.
 */
export const STATION_COLORS: Readonly<Record<string, string>> = {
  'air-filtering-unit': '#77bea3',
  'bitcoin-farm': '#e1b647',
  'booze-generator': '#b0d3e1',
  'cultist-circle': '#7b4d9d',
  'defective-wall': '#af6a50',
  'gear-rack': '#9a8661',
  'generator': '#d5902e',
  'gym': '#81868c',
  'hall-of-fame': '#c19c55',
  'heating': '#ef913a',
  'illumination': '#efd478',
  'intelligence-center': '#4daecd',
  'lavatory': '#5bb0ae',
  'library': '#a2764f',
  'medstation': '#db555a',
  'nutrition-unit': '#7bb657',
  'rest-space': '#9c86cc',
  'scav-case': '#a2954e',
  'security': '#c54d40',
  'shooting-range': '#d3663d',
  'solar-power': '#92ada0',
  'stash': '#a89464',
  'vents': '#8fadbd',
  'water-collector': '#83b8e0',
  'weapon-rack': '#79815f',
  'workbench': '#ad7c4b',
}

export const stationColor = (normalizedName?: string) => (normalizedName && STATION_COLORS[normalizedName]) || '#8a8478'
