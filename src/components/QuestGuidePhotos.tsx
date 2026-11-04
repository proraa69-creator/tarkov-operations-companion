import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Camera } from 'lucide-react'
import type { Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
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
  const ext = (file.file.split('.').pop() ?? 'png').toLowerCase().replace('jpeg', 'jpg')
  // Always from our server, which keeps every listed photo (server/src/services/guideImages.ts storeListed; owner,
  // 03.11.2026: «должны быть скачаны к нам на сервер и браться теперь от туда»), whatever the app or browser.
  return `https://raidos.app/v1/guide-images/wiki-${id}${thumb ? '-t' : ''}.${ext}`
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
    {open && <ImageViewer images={open.urls} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)} credit={guide.wiki ? uiText('Фото: EFT Wiki (CC BY-SA)') : undefined} closeOnClick />}
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
export function QuestGuidePhotoStrip({ questId, focusObjectiveId }: { questId: Quest['id']; focusObjectiveId?: string }) {
  const found = useQuestGuide(questId)
  const [open, setOpen] = useState<number | null>(null)
  const { locale } = useLocale()
  if (!found) return null
  const { data, guide } = found

  const focused = focusObjectiveId ? guide.photos.filter((photo) => photoOfObjective(photo, { id: focusObjectiveId })) : []
  const photos = [...focused, ...guide.photos.filter((photo) => !focused.includes(photo))]
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
    {open !== null && <ImageViewer images={photos.map((photo) => pictureUrl(data, photo.id, false))} index={open} onIndex={setOpen} onClose={() => setOpen(null)} credit={guide.wiki ? uiText('Фото: EFT Wiki (CC BY-SA)') : undefined} closeOnClick />}
  </div>
}

/** The way from a line to its window crosses a gap and other lines: the window waits this long for the mouse. */
const POPUP_LEAVE_MS = 350
/** Another line takes the window only when the mouse stays on it this long: on the way up to a photo it just crosses them. */
const POPUP_SWITCH_MS = 180
/** After the full-size view the mouse is somewhere else: a moment to come back or go on to the next line. */
const POPUP_AFTER_VIEW_MS = 1500
const POPUP_GAP = 8
const POPUP_MARGIN = 8
/** A finger has no hover: on a phone the line's camera opens the photos at once. */
const canHover = () => typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover) and (pointer: fine)').matches
/** Where the window goes: over the whole quest window, so that it covers none of the lines, from the line's left edge. */
function popupAnchor(line: Element) {
  const lineBox = line.getBoundingClientRect()
  const sheet = line.closest('.map-quest-sheet')?.getBoundingClientRect() ?? lineBox
  return { left: lineBox.left, top: sheet.top, bottom: sheet.bottom }
}
type PopupAnchor = ReturnType<typeof popupAnchor>

/**
 * Every place of a quest has its own photos in the map's quest window (owner, 04.11.2026, «Что-то мне это напоминает…», 27
 * places and 40 photos: «при наведении курсора мыши на какую-либо из точек появлялись всплывающее окно с фотографиями, и
 * можно было переместить курсор мыши на одну из фотографий, нажать, и она увеличится. Повторное нажатие выключает
 * фотографию … их можно листать … можно перенести мышку дальше на следующую цель»): the line's window shows only that
 * place's photos, stays while the mouse is on the line or on it, and the full-size view goes through those photos only.
 * The map keys the list by the quest, so another quest starts with nothing open.
 */
export function useObjectivePhotos(questId: string | undefined) {
  const found = useQuestGuide(questId ?? '')
  const [shown, setShown] = useState<{ key: string; photos: GuidePhoto[]; anchor: PopupAnchor } | null>(null)
  const [viewing, setViewing] = useState<{ photos: GuidePhoto[]; index: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const switching = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hold = useCallback(() => { clearTimeout(timer.current); clearTimeout(switching.current) }, [])
  const leave = useCallback((ms = POPUP_LEAVE_MS) => {
    hold()
    timer.current = setTimeout(() => setShown(null), ms)
  }, [hold])
  useEffect(() => hold, [hold])
  const photosOf = (objective: ObjectiveKeys) => (found ? found.guide.photos.filter((photo) => photoOfObjective(photo, objective)) : [])
  const rowProps = (key: string, photos: GuidePhoto[]) => (photos.length ? {
    onMouseEnter: (event: { currentTarget: Element }) => {
      if (!canHover()) return
      hold()
      if (shown?.key === key) return
      const next = { key, photos, anchor: popupAnchor(event.currentTarget) }
      if (shown) switching.current = setTimeout(() => setShown(next), POPUP_SWITCH_MS)
      else setShown(next)
    },
    // While a photo is open its overlay takes the mouse: that is not leaving.
    onMouseLeave: () => { if (!viewing) leave() },
  } : {})
  const data = found?.data
  const credit = found?.guide.wiki ? uiText('Фото: EFT Wiki (CC BY-SA)') : undefined
  const closeView = () => { setViewing(null); if (shown) leave(POPUP_AFTER_VIEW_MS) }
  const overlay = data && <>
    {shown && <ObjectivePhotoPopup key={shown.key} data={data} photos={shown.photos} anchor={shown.anchor} onEnter={hold} onLeave={() => { if (!viewing) leave() }} onOpen={(index) => { hold(); setViewing({ photos: shown.photos, index }) }} />}
    {viewing && <ImageViewer images={viewing.photos.map((photo) => pictureUrl(data, photo.id, false))} index={viewing.index} onIndex={(index) => setViewing({ ...viewing, index })} onClose={closeView} credit={credit} closeOnClick />}
  </>
  return { photosOf, rowProps, view: (photos: GuidePhoto[]) => { hold(); setViewing({ photos, index: 0 }) }, overlay }
}

function ObjectivePhotoPopup({ data, photos, anchor, onEnter, onLeave, onOpen }: { data: GuideData; photos: GuidePhoto[]; anchor: PopupAnchor; onEnter: () => void; onLeave: () => void; onOpen: (index: number) => void }) {
  const { locale } = useLocale()
  const box = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null)
  // Above, as the owner marked it; under it when there is no room above.
  useLayoutEffect(() => {
    const size = box.current?.getBoundingClientRect()
    if (!size) return
    const above = anchor.top - size.height - POPUP_GAP
    const top = above >= POPUP_MARGIN ? above : Math.min(anchor.bottom + POPUP_GAP, window.innerHeight - size.height - POPUP_MARGIN)
    setPlace({ left: Math.max(POPUP_MARGIN, Math.min(anchor.left, window.innerWidth - size.width - POPUP_MARGIN)), top: Math.max(POPUP_MARGIN, top) })
  }, [anchor, photos])
  const captionOf = (photo: GuidePhoto) => (locale === 'en' ? photo.captionEn ?? photo.caption : photo.caption)
  return createPortal(<div ref={box} className="objective-photo-popup" data-testid="objective-photo-popup" style={place ? place : { left: 0, top: 0, visibility: 'hidden' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
    <div className="objective-photo-grid" role="list">
      {photos.map((photo, index) => <button key={photo.id} type="button" role="listitem" className="objective-photo" onClick={() => onOpen(index)} title={captionOf(photo) || uiText('Фото места')}>
        <img src={pictureUrl(data, photo.id, true)} alt={captionOf(photo) || uiText('Фото места')} decoding="async" />
        {captionOf(photo) && <span>{captionOf(photo)}</span>}
      </button>)}
    </div>
  </div>, document.body)
}
