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
  {
    // Report of 10.11.2026 (owner, 11.11.2026: «добавь фото к спавну»): «Ключ от комнаты для расслаблений» on the table by the cleaver,
    // behind the door «Ключ от комнаты для серьезных переговоров» opens — the one of the key's twelve spots (guaranteedSpawns.ts)
    // that stands in that room.
    mapId: 'streets-of-tarkov',
    itemId: '6582dbf0b8d7830efc45016f',
    position: { x: 166.14, y: 2.12, z: 165.12 },
    photos: [{
      file: 'streets-negotiation-room-relaxation-key.webp',
      ru: 'Комната для серьёзных переговоров: на столе рядом с тесаком',
      en: 'The negotiation room: on the table by the cleaver',
    }],
  },
  {
    // Report of 10.11.2026: «Ключ от военного КПП» in the tent with the dead PMC east of the dorms — the feed's spot of this key there
    // (owner, 11.11.2026: «вставь фото из заявки»).
    mapId: 'customs',
    itemId: '5913915886f774123603c392',
    position: { x: 110.3, y: -2.5, z: 164 },
    photos: [{
      file: 'customs-dorms-tent-military-checkpoint.webp',
      ru: 'Палатка с мёртвым ЧВК к востоку от общежитий: на матрасе',
      en: 'The tent with the dead PMC east of the dorms: on the mattress',
    }],
  },
  {
    // Report 141 (11.11.2026): «Ключ от номера 306 восточного крыла Санатория» on the desk by the safe in the pier office — the
    // feed's spot of this key there (a metre from the safe and the system unit).
    mapId: 'shoreline',
    itemId: '5a145d4786f7744cbb6f4a12',
    position: { x: 478.75, y: -57.12, z: -315.13 },
    photos: [{
      file: 'shoreline-pier-office-east-306.webp',
      ru: 'Пирс, кабинет: на столе рядом с сейфом',
      en: 'The pier office: on the desk by the safe',
    }],
  },
]
