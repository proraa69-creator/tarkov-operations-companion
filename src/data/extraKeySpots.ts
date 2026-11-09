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
 * Loose keys players found where the feed (tarkov.dev loose loot) has none. Each becomes a «Ключи» point with its photo. Once
 * the feed lists the same key within EXTRA_KEY_SAME_SPOT_METRES, its own point is used and this one is not drawn twice.
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
    // Report of 10.11.2026: «Ключ от комнаты заведующего общежития» on the frying pan in the living container of the Scav Farm.
    // The feed's loose spot of that table (no key in its list); the player's position screenshot stood a metre from it.
    mapId: 'shoreline',
    itemId: '664d4b0103ef2c61246afb56',
    position: { x: -630.1, y: -25.5, z: -241.0 },
    photos: [{
      file: 'shoreline-scav-farm-dorm-overseer.webp',
      ru: 'Ферма Диких, жилой контейнер: на сковороде на столе',
      en: 'Scav Farm, the living container: on the frying pan on the table',
    }],
  },
]
