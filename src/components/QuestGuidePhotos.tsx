import { useEffect, useState } from 'react'
import { Camera } from 'lucide-react'
import type { Quest } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { usesDataGateway } from '../data/tarkovApi'
import { isDesktopShell, isNative } from '../platform'
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
interface GuidePhoto { id: string; caption: string; captionEn?: string; objectiveId?: string }
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
  // The apps show pictures from raidos.app only (src/app/contentSecurityPolicy.ts); a browser in development takes the wiki's.
  if (usesDataGateway() || isDesktopShell() || isNative()) return `https://raidos.app/v1/guide-images/wiki-${id}${thumb ? '-t' : ''}.${ext}`
  return thumb ? file.url.replace(/\/scale-to-width-down\/\d+/, '/scale-to-width-down/400') : file.url
}

export function QuestGuidePhotos({ quest }: { quest: { id: Quest['id']; objectiveDetails?: ReadonlyArray<{ id: string; description: string }> } }) {
  const [data, setData] = useState<GuideData | null>(null)
  const [open, setOpen] = useState<{ urls: string[]; index: number } | null>(null)
  const { locale } = useLocale()
  useEffect(() => {
    let live = true
    void loadGuides().then((value) => { if (live) setData(value) }, () => {})
    return () => { live = false }
  }, [])
  const guide = data?.quests[quest.id]
  if (!data || !guide?.photos.length) return null

  const objectives = quest.objectiveDetails ?? []
  const groups = [
    ...objectives.map((objective) => ({ key: objective.id, title: objective.description, photos: guide.photos.filter((photo) => photo.objectiveId === objective.id) })),
    { key: 'quest', title: 'Весь квест', photos: guide.photos.filter((photo) => !photo.objectiveId || !objectives.some((objective) => objective.id === photo.objectiveId)) },
  ].filter((group) => group.photos.length)
  const all = groups.flatMap((group) => group.photos)
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
    {open && <ImageViewer images={open.urls} index={open.index} onIndex={(index) => setOpen({ ...open, index })} onClose={() => setOpen(null)} credit={guide.wiki ? uiText('Фото: EFT Wiki (CC BY-SA)') : undefined} />}
  </div>
}
