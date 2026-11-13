/**
 * Bumped whenever the pictures on the server change under the same name: the server sends them as immutable for a week
 * (server/src/routes/guideImages.ts), so the apps must ask at another address to see the new ones. 2: the game's version
 * and the screenshot's path cropped off (owner, 05.11.2026). The server ignores the query.
 */
const PICTURES_EDITION = 2

/**
 * An exit's or a quest's photo, always from our server, which keeps every listed one (server/src/services/guideImages.ts
 * storeListed; owner, 03.11.2026: «должны быть скачаны к нам на сервер и браться теперь от туда»), whatever the app or browser.
 */
export function guidePhotoUrl(id: string, file: string, thumb: boolean) {
  const ext = (file.split('.').pop() ?? 'png').toLowerCase().replace('jpeg', 'jpg')
  return `https://raidos.app/v1/guide-images/wiki-${id}${thumb ? '-t' : ''}.${ext}?v=${PICTURES_EDITION}`
}
