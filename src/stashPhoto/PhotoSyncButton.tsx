import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Loader2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { labelEngine, photoCandidates, photoPixels, type WantedItem } from './browser'
import { scanStashPhoto, type ScanStage } from './scan'
import '../styles/stashPhoto.css'

export interface PhotoSyncItem extends WantedItem { name: string; iconUrl?: string }
export interface PhotoPick { id: string; count: number }

type View =
  | { kind: 'idle' }
  | { kind: 'busy'; stage: ScanStage | 'start' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; rows: Array<{ item: PhotoSyncItem; count: number; doubtful: boolean }>; labelsRead: boolean }

const STAGE_TEXT: Record<ScanStage | 'start', string> = {
  start: 'Готовим фото…',
  grid: 'Ищем сетку схрона…',
  labels: 'Читаем подписи предметов…',
  pictures: 'Сравниваем картинки…',
}

/**
 * «Синхронизация по фото» (owner, 17.10.2026; phone only): the button opens the camera at once (a file input with
 * `capture`), the photo of the stash on the screen is recognised on the phone (src/stashPhoto/scan.ts) and the wanted
 * items it shows are listed — doubtful ones unticked — to be added with one press. The photo lives only in memory for
 * the scan: it is never uploaded or saved, so nothing of it reaches the server.
 */
export function PhotoSyncButton({ items, catalogNames, onApply }: { items: PhotoSyncItem[]; catalogNames?: readonly string[]; onApply: (picks: PhotoPick[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [view, setView] = useState<View>({ kind: 'idle' })
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set())
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const run = async (file: File) => {
    setView({ kind: 'busy', stage: 'start' })
    let engine: Awaited<ReturnType<typeof labelEngine>> | null = null
    try {
      const [pixels, candidates] = await Promise.all([photoPixels(file), photoCandidates(items)])
      engine = await labelEngine().catch(() => null)
      const result = await scanStashPhoto(pixels, candidates, {
        readLabels: engine?.read,
        catalogNames,
        onStage: (stage) => { if (alive.current) setView({ kind: 'busy', stage }) },
      })
      if (!alive.current) return
      if (!result.ok) {
        setView({ kind: 'error', message: 'Сетка схрона не найдена — снимите экран ровнее, весь схрон в кадре.' })
        return
      }
      const byId = new Map(items.map((item) => [item.id, item]))
      const rows = result.items.flatMap((entry) => { const item = byId.get(entry.id); return item ? [{ item, count: entry.count, doubtful: entry.doubtful }] : [] })
      setTicked(new Set(rows.filter((row) => !row.doubtful).map((row) => row.item.id)))
      setView({ kind: 'done', rows, labelsRead: result.labelsRead })
    } catch {
      if (alive.current) setView({ kind: 'error', message: 'Не удалось распознать фото. Попробуйте ещё раз.' })
    } finally {
      await engine?.close().catch(() => {})
    }
  }

  const close = () => setView({ kind: 'idle' })
  const toggle = (id: string) => setTicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const apply = () => {
    if (view.kind !== 'done') return
    onApply(view.rows.filter((row) => ticked.has(row.item.id)).map((row) => ({ id: row.item.id, count: row.count })))
    close()
  }
  const chosen = view.kind === 'done' ? view.rows.filter((row) => ticked.has(row.item.id)).length : 0

  return <>
    <button type="button" className="button primary photo-sync-button" disabled={!items.length || view.kind === 'busy'} onClick={() => input.current?.click()}>
      <Camera size={15} />{uiText(' Синхронизация по фото')}
    </button>
    <input ref={input} className="photo-sync-input" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true"
      onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void run(file) }} />
    {view.kind !== 'idle' && <div className="photo-sync-backdrop" onClick={view.kind === 'busy' ? undefined : close}>
      <div className="panel photo-sync-sheet" role="dialog" aria-modal="true" aria-label={uiText('Синхронизация по фото')} onClick={(event) => event.stopPropagation()}>
        <div className="photo-sync-head">
          <strong>{uiText('Синхронизация по фото')}</strong>
          {view.kind !== 'busy' && <button type="button" className="icon-button" onClick={close} aria-label={uiText('Закрыть')}><X size={16} /></button>}
        </div>
        {view.kind === 'busy' && <p className="photo-sync-status" role="status"><Loader2 size={16} className="spin" />{uiText(STAGE_TEXT[view.stage])}</p>}
        {view.kind === 'error' && <p className="photo-sync-status is-error" role="alert">{uiText(view.message)}</p>}
        {view.kind === 'done' && <>
          {view.rows.length
            ? <ul className="photo-sync-list">
              {view.rows.map(({ item, count, doubtful }) => <li key={item.id}>
                <button type="button" className={`photo-sync-row${ticked.has(item.id) ? ' is-ticked' : ''}`} aria-pressed={ticked.has(item.id)} onClick={() => toggle(item.id)}>
                  <span className="photo-sync-check">{ticked.has(item.id) && <Check size={13} />}</span>
                  {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="photo-sync-icon" />}
                  <span className="photo-sync-name">{uiText(item.name)}{count > 1 && <small> ×{count}</small>}</span>
                  {doubtful && <span className="tag photo-sync-doubt">{uiText('сомнительно')}</span>}
                </button>
              </li>)}
            </ul>
            : <p className="photo-sync-status">{uiText('Нужных предметов на фото не найдено.')}</p>}
          {!view.labelsRead && <p className="dim photo-sync-note">{uiText('Подписи предметов прочитать не удалось — найдено только по картинкам, проверьте список.')}</p>}
          <p className="dim photo-sync-note">{uiText('Фото обработано на телефоне и никуда не отправлялось.')}</p>
          <div className="photo-sync-actions">
            <button type="button" className="button ghost" onClick={() => input.current?.click()}><Camera size={14} />{uiText(' Ещё фото')}</button>
            <button type="button" className="button primary" disabled={!chosen} onClick={apply}>{uiText(`Добавить ${chosen}`)}</button>
          </div>
        </>}
      </div>
    </div>}
  </>
}
