/**
 * The hideout's picture (owner, 20.11.2026: «вид должен быть только вот такой сверху, и с этого виду сверху должны меняться модули…
 * картинка вставляется с новым модулем, прям кусок картинки, только чтобы все стыки, все совпадало. Постоянно один ракурс, но модули
 * разные»): taken in the offline copy of the game on E: by the BepInEx plugin RaidOsHideout (E:\SPT-photo\hideout) from one camera
 * above the hideout, turned into pictures by scripts/hideout-views.mjs:
 * - `base-L<light>.webp` — the hideout with every module at level 0, under the light of that Illumination level (0–3);
 * - `<station id>-<level>-L<light>.webp` — the piece of the picture that module changes at that level (soft edged), laid on the base;
 * The rooms behind the defective wall are black on the base (the game draws them only from the wall's breach) and come with the
 * wall's own piece; the modules in them show only once it is broken («комнаты закрыты… не должны подсвечиваться»).
 * The station id is the game's area template id, the same as tarkov.dev's. hideoutViews.json keeps the picture's size, where every
 * module's button sits (the game's own area icon point) and where each piece goes, in pixels of the picture.
 */
import views from '../data/hideoutViews.json'

const files = import.meta.glob<string>('../assets/hideout-views/*.webp', { eager: true, import: 'default' })
const byName = new Map(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.webp$/, ''), url]))

export interface HideoutViewsFile {
  /** The picture's width and height in pixels. */
  size?: number[]
  /** The lights with a base: Illumination levels. */
  lights?: number[]
  /** The Illumination station: its built level is the light. */
  lightStation?: string
  /** Station id → the button's place, [x, y] in 0..1 of the picture. */
  spots?: Record<string, number[]>
  /** Station id → level → light → [x, y, width, height] of its piece in pixels. */
  pieces?: Record<string, Record<string, Record<string, number[]>>>
  /** The rooms behind the defective wall: the wall's station, the level that opens them and the stations inside. */
  rooms?: { station?: string; openLevel: number; inside?: string[] }
}

const file = views as HideoutViewsFile

export const pictureSize = file.size?.length === 2 ? { width: file.size[0]!, height: file.size[1]! } : undefined
export const lightStation = file.lightStation
export const roomsInfo = file.rooms

/** The light a built Illumination level gives: the nearest one shot at or below it, else the lowest. */
export function lightOf(illumination: number): number {
  const shot = [...(file.lights ?? [])].sort((a, b) => a - b)
  return [...shot].reverse().find((light) => light <= illumination) ?? shot[0] ?? 0
}

export const basePicture = (light: number) => byName.get(`base-L${light}`)

export function moduleSpot(stationId: string): { x: number; y: number } | undefined {
  const spot = file.spots?.[stationId]
  return spot && spot.length === 2 ? { x: spot[0]!, y: spot[1]! } : undefined
}

export interface PicturePiece { url: string; left: number; top: number; width: number; height: number }

/** The piece of a module at a level under a light, placed in fractions of the picture; none when the level changes nothing seen. */
export function modulePiece(stationId: string, level: number, light: number): PicturePiece | undefined {
  const rect = file.pieces?.[stationId]?.[String(level)]?.[String(light)]
  const url = byName.get(`${stationId}-${level}-L${light}`)
  if (!rect || rect.length !== 4 || !url || !pictureSize) return undefined
  return { url, left: rect[0]! / pictureSize.width, top: rect[1]! / pictureSize.height, width: rect[2]! / pictureSize.width, height: rect[3]! / pictureSize.height }
}

export const roomsPicture = () => byName.get('rooms')

/** The rooms behind the defective wall are closed while the wall is below the breach (the game draws them only from it). */
export function roomsClosed(built: Readonly<Record<string, number>>) {
  return Boolean(file.rooms?.station) && (built[file.rooms!.station!] ?? 0) < file.rooms!.openLevel
}
