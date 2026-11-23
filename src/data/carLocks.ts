import type { KeySpotPhoto } from './extraKeySpots'
import PLACE_PHOTOS from './placePhotos.json'

/**
 * Locked cars (owner, 23.11.2026: «запертая дверь или багажник машины нужно переименовать просто багажник машины. Нужен ключ от
 * автомобиля «Жигули». Все. Все машины у нас должны писаться так. И нужно сделать фото каждой машины»): a car lock (the feed's
 * `trunk`) is «Багажник машины», its key named by the car it opens, and the car's own frame from the offline game.
 */
export const CAR_LOCK_TITLE = 'Багажник машины'

/** The car a key opens, by the key's id (the key's name says it only in part). */
const CAR_NAMES: Readonly<Record<string, string>> = {
  // Customs
  '5913651986f774432f15d132': 'Жигули',
  // Lighthouse
  '61aa5b518f5e7a39b41416e2': 'Merin',
  '61aa5aed32a4743c3453d319': 'Полиция',
  // Shoreline
  '5a0eb38b86f774153b320eb0': 'SMW',
  // Streets of Tarkov
  '68e63b56ad8cba49190ea529': 'Почта Руси',
}

/** The car's name for a key: ours by its id, else the key's name without «Ключ от автомобиля» and the like. */
export function carName(keyId: string | undefined, keyName: string) {
  const named = keyId ? CAR_NAMES[keyId] : undefined
  if (named) return named
  const bare = keyName.replace(/^Ключ(?:-брелок)?\s+от\s+(?:автомобиля|машины|кабины)\s*/i, '').trim()
  return bare || keyName.trim()
}

/** «Нужен ключ от автомобиля «Жигули».» */
export const carNeedsText = (car: string) => `Нужен ключ от автомобиля «${car}».`

/**
 * Our own frames of the places the feed has no photo list for (the offline game, src/assets/key-spots; written by
 * E:/SPT-photo/eval/integrate_all.py): each locked car by the feed's lock id (json.tarkov.dev <mode>/maps `locks`), a
 * guaranteed spawn by «<map>/<item id>».
 */
const PLACES = PLACE_PHOTOS as { locks: Record<string, KeySpotPhoto[]>; spawns: Record<string, KeySpotPhoto[]> }
export const CAR_PHOTOS: Readonly<Record<string, readonly KeySpotPhoto[]>> = PLACES.locks
export const SPAWN_PHOTOS: Readonly<Record<string, readonly KeySpotPhoto[]>> = PLACES.spawns
