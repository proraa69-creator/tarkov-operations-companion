/**
 * The pictures of the chat's stickers (src/shared/supportStickers.ts): our own drawings in src/assets/stickers/<id>.svg, bundled by
 * every build (the app, the website, the owner's iPhone admin) through the bundler, so a sticker's address is always right.
 */
const PICTURES = import.meta.glob<string>('../assets/stickers/*.svg', { eager: true, query: '?url', import: 'default' })

const byId = new Map(Object.entries(PICTURES).map(([file, url]) => [file.replace(/^.*\/([^/]+)\.svg$/, '$1'), url]))

export function stickerPictureUrl(id: string): string | undefined {
  return byId.get(id)
}
