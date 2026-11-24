import fireSectors from './fireSectors.json'

/**
 * Where the game's own guards shoot at whoever comes close (report №110; owner 09.11.2026: «сделай… с изгибами… только самые
 * основные»: Shoreline's «Временный КПП» and the Terminal transit, one zone; Lighthouse's bridge to Lightkeeper Island with
 * its conditions; no other map — their sniper borders already show as red zones). Shoreline's from the scene files of EFT
 * 1.3.0.1 (the Utyos fire zone, its revenge zones and the guarded transit zone, joined and smoothed); Lighthouse's bridge
 * drawn by its claymores (tarkov.dev minefields). Game metres [x, z] like tarkov.dev's outlines; `fireSectors.json`.
 */
export interface FireSector {
  id: string
  kind: 'machine-gun' | 'lightkeeper'
  outline: ReadonlyArray<readonly [number, number]>
}

const FIRE_SECTORS = (fireSectors as unknown as { maps: Record<string, FireSector[]> }).maps

export function fireSectorsOf(mapId: string): readonly FireSector[] {
  return FIRE_SECTORS[mapId] ?? []
}

/** The encoded DSP radio transmitter: Zryachiy lets its bearer cross (tarkov.dev id). */
export const DSP_TRANSMITTER_ID = '62e910aaf957f2915e0a5e36'

export const FIRE_SECTOR_TEXT: Record<FireSector['kind'], { title: string; lines: readonly string[]; itemId?: string }> = {
  'machine-gun': {
    title: 'Зона обстрела',
    lines: ['Пулемёты «Утёс» на вышках стреляют по подходам к переходу на Терминал.'],
  },
  lightkeeper: {
    title: 'Мост к острову Смотрителя',
    lines: [
      'Зрячий и его свита стреляют, а клейморы срабатывают, если:',
      '• в спецслоте нет закодированного передатчика DSP;',
      '• вы попали по Зрячему или его людям — передатчик теряет код.',
    ],
    itemId: DSP_TRANSMITTER_ID,
  },
}
