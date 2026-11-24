import { usesDataGateway } from './tarkovApi'

const TARKOV_DEV_PICTURE = /^https:\/\/assets\.tarkov\.dev\/([a-f0-9]{24})-(icon|grid-image|base-image)\.webp$/

/**
 * An item picture address that still points at tarkov.dev, as our server's file (report 210: «Не прогружаются иконки
 * оружия» in a boss's card on the map). The server swaps only the catalogue items' pictures for its own
 * (server/src/services/itemImageCache.ts); a map marker's boss gear keeps tarkov.dev's address, and the players' app
 * cancels every request to tarkov.dev (electron/main.ts). The server has the same files, and the desktop app falls back
 * to tarkov.dev itself for one it lacks (electron/itemImages.ts).
 */
export function servedItemPicture(url: string | undefined, gateway = usesDataGateway()): string | undefined {
  if (!url || !gateway) return url
  const match = TARKOV_DEV_PICTURE.exec(url)
  return match ? `https://raidos.app/v1/item-images/${match[1]}-${match[2].replace('-image', '')}.webp` : url
}
