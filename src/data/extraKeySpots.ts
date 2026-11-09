/**
 * A photo of the place where a key lies (the player's own screenshot, the game's interface cut off): a file of
 * src/assets/key-spots, resolved by the app (src/maps/SpotPhotos.tsx) — the server builds the markers too and takes no pictures.
 */
export interface KeySpotPhoto {
  file: string
  ru: string
  en: string
}

/**
 * Loose keys players found, with a photo of the place. Where the feed (tarkov.dev loose loot) lists the same key within
 * EXTRA_KEY_SAME_SPOT_METRES, the photo goes on the feed's point; elsewhere the spot becomes a «Ключи» point of its own.
 */
export interface ExtraKeySpot {
  mapId: string
  itemId: string
  position: { x: number; y: number; z: number }
  photos: readonly KeySpotPhoto[]
}

export const EXTRA_KEY_SAME_SPOT_METRES = 1.5

export const EXTRA_KEY_SPOTS: readonly ExtraKeySpot[] = [
  {
    // Reports of 10.11.2026: «Ключ от комнаты заведующего общежития» on the frying pan in the living container of the Scav Farm —
    // the small room at the building's north-east wall, a spot the feed already lists for this key (the second report circled it).
    mapId: 'shoreline',
    itemId: '664d4b0103ef2c61246afb56',
    position: { x: -653.4, y: -25.0, z: -237.2 },
    photos: [{
      file: 'shoreline-scav-farm-dorm-overseer.webp',
      ru: 'Ферма Диких, жилой контейнер: на сковороде на столе',
      en: 'Scav Farm, the living container: on the frying pan on the table',
    }],
  },
]
