import { useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import type { Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { guidePhotoUrl } from '../data/guidePhotoUrl'
import { ImageViewer } from './ImageViewer'
import './questGuidePhotos.css'

/**
 * «Фото мест» of a quest (owner, 28.10.2026: «по каждому квесту найти в интернете… фото места… добавь их нам… сопоставь
 * квесты и задачи»): the EFT Wiki's walkthrough screenshots (scripts/quest-guide-photos.mjs → src/data/questGuidePhotos.json)
 * under the objective each one shows, the rest under «Весь квест»; a click opens them full size. The players' apps take
 * the pictures from our server (server/src/services/guideImages.ts): the app shows images from raidos.app only. No maps
 * (owner, 02.11.2026: «удали там фото с картами, там чужие карты»: scripts/quest-guide-photos.mjs isMapPicture), every
 * caption in Russian, the English one in English; the source shows in the full-size view, not under the photos («убери
 * надпись откуда взято»). The Halloween 2026 quests' places come from their own list (src/data/eventGuidePhotos.json),
 * with no source line at all (owner, 02.11.2026: «не добавляй надписи что взять с …»).
 */
interface GuidePhoto { id: string; caption: string; captionEn?: string; objectiveId?: string; alsoFor?: string[] }
/** An objective as the catalog has it: `id` may be its text, and the game's own id, which the photos use, rides in `gameId`. */
type ObjectiveKeys = { id: string; gameId?: string }

/** This photo shows this objective's place (`alsoFor`: a file the walkthrough shows under two places). */
function photoOfObjective(photo: GuidePhoto, objective: ObjectiveKeys) {
  const ids = [photo.objectiveId, ...(photo.alsoFor ?? [])]
  return ids.includes(objective.id) || Boolean(objective.gameId && ids.includes(objective.gameId))
}
/** `wiki`: the quest's EFT Wiki page; the event quests' own list (src/data/eventGuidePhotos.json, Halloween 2026) has none. */
interface GuideData { quests: Record<string, { wiki?: string; photos: GuidePhoto[] }>; files: Record<string, { file: string; url: string }> }

let loading: Promise<GuideData> | null = null
/** The list is half a megabyte: loaded once, the first time a quest card asks; the event quests' photos with it. */
const loadGuides = () => (loading ??= Promise.all([import('../data/questGuidePhotos.json'), import('../data/eventGuidePhotos.json')]).then(([wiki, event]) => {
  const own = wiki.default as unknown as GuideData
  const extra = event.default as unknown as GuideData
  return { quests: { ...own.quests, ...extra.quests }, files: { ...own.files, ...extra.files } }
}))

function pictureUrl(data: GuideData, id: string, thumb: boolean) {
  const file = data.files[id]
  if (!file) return ''
  return guidePhotoUrl(id, file.file, thumb)
}

/** The quest's photos once the list has loaded; null before that and for a quest without photos. */
function useQuestGuide(questId: string) {
  const [data, setData] = useState<GuideData | null>(null)
  useEffect(() => {
    let live = true
    void loadGuides().then((value) => { if (live) setData(value) }, () => {})
    return () => { live = false }
  }, [])
  const guide = data?.quests[questId]
  return data && guide?.photos.length ? { data, guide } : null
}

export function QuestGuidePhotos({ quest }: { quest: { id: Quest['id']; objectiveDetails?: ReadonlyArray<ObjectiveKeys & { description: string }> } }) {
  const found = useQuestGuide(quest.id)
  const [open, setOpen] = useState<{ urls: string[]; index: number } | null>(null)
  const { locale } = useLocale()
  if (!found) return null
  const { data, guide } = found

  const objectives = quest.objectiveDetails ?? []
  const groups = [
    ...objectives.map((objective) => ({ key: objective.id, title: objective.description, photos: guide.photos.filter((photo) => photoOfObjective(photo, objective)) })),
    { key: 'quest', title: 'Весь квест', photos: guide.photos.filter((photo) => !objectives.some((objective) => photoOfObjective(photo, objective))) },
  ].filter((group) => group.photos.length)
  // A file shown under two places is one photo in the viewer.
  const all = [...new Set(groups.flatMap((group) => group.photos))]
  const show = (photo: GuidePhoto) => setOpen({ urls: all.map((entry) => pictureUrl(data, entry.id, false)), index: all.indexOf(photo) })
  const captionOf = (photo: GuidePhoto) => locale === 'en' ? photo.captionEn ?? photo.caption : photo.caption

  return <div className="detail-section quest-guide-photos">
    <h4><Camera size={14} aria-hidden="true" /> {uiText('Фото мест')} <span className="dim">· {all.length}</span></h4>
    {groups.map((group) => <div key={group.key} className="quest-guide-group">
      {groups.length > 1 && <p className="quest-guide-objective">{uiText(group.title)}</p>}
      <div className="quest-guide-grid" role="list">
        {group.photos.map((photo) => <button key={photo.id} type="button" role="listitem" className="quest-guide-photo" onClick={() => show(photo)} title={captionOf(photo) || undefined}>
          <img src={pictureUrl(data, photo.id, true)} alt={captionOf(photo) || uiText('Фото места')} loading="lazy" decoding="async" />
          {captionOf(photo) && <span>{captionOf(photo)}</span>}
        </button>)}
      </div>
    </div>)}
    {open && <ImageViewer images={open.urls} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)} closeOnClick />}
  </div>
}

/** Thumbnails in the map's quest window; the last one shown carries «+N» for the rest. */
const STRIP_PHOTOS = 3

/**
 * The quest window on the map (src/pages/MapsPage.tsx): the quest's «Фото мест» as a row of thumbnails in the empty space
 * under its title (owner, 02.11.2026: «если задание с "картинкой", можно добавить ее как раз таки в пустое место в окне
 * снизу… если не понимаешь где именно нужно посмотреть»), the photos of the objective whose point was clicked first. A click
 * opens them all full size; «Открыть задание» shows them under their objectives.
 */
export function QuestGuidePhotoStrip({ questId, focusObjectiveId, objectives }: {
  questId: Quest['id']
  focusObjectiveId?: string
  /** Only these objectives' photos: the window lists only this map's objectives (progression/sheetObjectives.ts onlyHere). */
  objectives?: ReadonlyArray<ObjectiveKeys>
}) {
  const found = useQuestGuide(questId)
  const [open, setOpen] = useState<number | null>(null)
  const { locale } = useLocale()
  if (!found) return null
  const { data, guide } = found

  const pool = objectives ? guide.photos.filter((photo) => objectives.some((objective) => photoOfObjective(photo, objective))) : guide.photos
  if (!pool.length) return null
  const focused = focusObjectiveId ? pool.filter((photo) => photoOfObjective(photo, { id: focusObjectiveId })) : []
  const photos = [...focused, ...pool.filter((photo) => !focused.includes(photo))]
  const shown = photos.slice(0, STRIP_PHOTOS)
  const more = photos.length - shown.length
  const captionOf = (photo: GuidePhoto) => (locale === 'en' ? photo.captionEn ?? photo.caption : photo.caption) || uiText('Фото места')

  return <div className="map-quest-sheet-photos">
    <h4><Camera size={12} aria-hidden="true" /> {uiText('Фото мест')} <span className="dim">· {photos.length}</span></h4>
    <div className="map-sheet-photo-row" role="list">
      {shown.map((photo, index) => <button key={photo.id} type="button" role="listitem" className="map-sheet-photo" onClick={() => setOpen(index)} title={captionOf(photo)}>
        <img src={pictureUrl(data, photo.id, true)} alt={captionOf(photo)} loading="lazy" decoding="async" />
        {more > 0 && index === shown.length - 1 && <span className="map-sheet-photo-more" aria-hidden="true">+{more}</span>}
      </button>)}
    </div>
    {open !== null && <ImageViewer images={photos.map((photo) => pictureUrl(data, photo.id, false))} index={open} onIndex={setOpen} onClose={() => setOpen(null)} closeOnClick />}
  </div>
}

/**
 * Every place of a quest has its own photos in the map's quest window (owner, 04.11.2026, «Что-то мне это напоминает…»): the
 * line's camera opens that place's photos full size, and the arrows go through those photos only. A line no longer shows
 * them on hover: the photo shows over the place's point on the map (MarkerPlacePhoto; report 167, owner, 15.11.2026: «при
 * наведении на цель… фотографии не появляется, она будет появляться при наведении на метку, которая на карте»).
 */
export function useObjectivePhotos(questId: string | undefined) {
  const found = useQuestGuide(questId ?? '')
  const [viewing, setViewing] = useState<{ photos: GuidePhoto[]; index: number } | null>(null)
  const photosOf = (objective: ObjectiveKeys) => (found ? found.guide.photos.filter((photo) => photoOfObjective(photo, objective)) : [])
  const data = found?.data
  const overlay = data && viewing && <ImageViewer images={viewing.photos.map((photo) => pictureUrl(data, photo.id, false))} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} closeOnClick />
  return { photosOf, view: (photos: GuidePhoto[]) => setViewing({ photos, index: 0 }), overlay }
}

/** The map asks for the list as it opens, so that the first point the mouse comes to already has its photo. */
export const preloadQuestGuidePhotos = () => { void loadGuides().catch(() => {}) }

/** The full-size view of a point's photos: it lives on the map, not in the point's card, which closes as the mouse leaves. */
export function usePlacePhotoViewer() {
  const [viewing, setViewing] = useState<{ urls: string[]; index: number } | null>(null)
  const overlay = viewing && <ImageViewer images={viewing.urls} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={() => setViewing(null)} closeOnClick />
  return { open: (urls: string[], index: number) => setViewing({ urls, index }), overlay }
}

/**
 * The place's photo in its point's card on the map, small (report 167: «сделайте над меткой фотку и поменьше, фото слишком
 * большое, перегораживает всю карту»; owner, 15.11.2026: «навёл курсор на метку, появилось окошечко с фотографией места»).
 * The mouse goes on to it (maps/holdTooltip.ts) and a click opens this place's photos full size, only them, not the whole
 * quest's («если у конкретной точки своё место, свои фотографии, значит, должны быть только они»); «+N» opens the next one.
 * The card sits inside Leaflet's map: the clicks are taken here, before the map would start a drag or close the quest.
 */
export function MarkerPlacePhoto({ questId, objectiveId, onOpen }: { questId: string; objectiveId: string; onOpen: (urls: string[], index: number) => void }) {
  const found = useQuestGuide(questId)
  const { locale } = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const photos = found ? found.guide.photos.filter((photo) => photoOfObjective(photo, { id: objectiveId })) : []
  // One key for the effect: the list of this place's full-size pictures.
  const urls = found ? photos.map((photo) => pictureUrl(found.data, photo.id, false)).join(' ') : ''
  useEffect(() => {
    const element = box.current
    if (!element || !urls) return
    const stop = (event: Event) => event.stopPropagation()
    const click = (event: MouseEvent) => {
      event.stopPropagation()
      onOpen(urls.split(' '),(event.target as Element).closest('[data-more]') ? 1 : 0)
    }
    const kinds = ['mousedown', 'pointerdown', 'dblclick', 'wheel', 'contextmenu'] as const
    kinds.forEach((kind) => element.addEventListener(kind, stop))
    element.addEventListener('click', click)
    return () => { kinds.forEach((kind) => element.removeEventListener(kind, stop)); element.removeEventListener('click', click) }
  }, [urls, onOpen])
  const [first] = photos
  if (!found || !first) return null
  const caption = (locale === 'en' ? first.captionEn ?? first.caption : first.caption) || uiText('Фото места')
  return <div ref={box} className="mmt-place-photo" data-testid="marker-place-photo" role="button" tabIndex={-1} title={caption}>
    <img className="mmt-shot" src={pictureUrl(found.data, first.id, true)} alt={caption} decoding="async" />
    {photos.length > 1 && <b data-more="">+{photos.length - 1}</b>}
  </div>
}
