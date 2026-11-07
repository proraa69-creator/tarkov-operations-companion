import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Eye, EyeOff, LoaderCircle, Pencil, Plus, Sticker, Trash2, X } from 'lucide-react'
import { uiText } from '../../i18n/renderText'
import { adminApi, type AdminStickerPack } from '../adminApi'
import { errorText } from '../adminFormat'
import { AdminEmpty, AdminLoading } from '../adminShared'
import { STICKER_LIMITS } from '../../shared/supportStickers'
import { stickerPictureSrc } from '../../support/stickerCatalog'
import { moved } from './stickerLayout'
import './stickers.css'

/** The editor, the segmenter and the fonts load only when «Новый стикер» is pressed. */
const StickerEditor = lazy(() => import('./StickerEditor').then((module) => ({ default: module.StickerEditor })))

const stickersCount = (count: number) => uiText(`Стикеров: ${count}`)

/**
 * «Стикеры» of the iPhone admin (owner, 07.11.2026: «в админ приложении на телефоне сделай мне функцию добавлять стикеры…
 * И там я буду делать паки стикеров. Которые по нажатию кнопки добавить будут добавляться в приложение на ПК и телефон»):
 * the packs (a new one, the order), and one pack — its stickers (the order, deleting one), «Новый стикер»
 * (StickerEditor), «Добавить» (every app's sticker picker shows it at once, without an update) / «Убрать», rename, delete.
 */
export function StickerPacksSheet({ onClose }: { onClose: () => void }) {
  const [packs, setPacks] = useState<AdminStickerPack[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let active = true
    adminApi.stickerPacks().then(
      (answer) => { if (active) { setPacks(answer.packs); setError('') } },
      (reason: unknown) => { if (active) setError(errorText(reason)) },
    )
    return () => { active = false }
  }, [version])

  /** A change on the server; its answer is every pack as it is now. */
  const change = useCallback(async (work: () => Promise<{ packs: AdminStickerPack[] }>) => {
    setBusy(true)
    setError('')
    try {
      setPacks((await work()).packs)
      return true
    } catch (reason) {
      setError(errorText(reason))
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const create = async () => {
    const wanted = name.trim()
    if (!wanted || busy) return
    let created = ''
    if (await change(async () => { const answer = await adminApi.createStickerPack(wanted); created = answer.pack.id; return answer })) {
      setName('')
      setOpenId(created)
    }
  }

  const pack = packs?.find((entry) => entry.id === openId)
  if (pack) return <PackView pack={pack} busy={busy} error={error} change={change} onBack={() => { setOpenId(null); setError('') }} onClose={onClose} />

  const ids = (packs ?? []).map((entry) => entry.id)
  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={uiText('Стикеры')}>
      <header className="admin-sheet-head">
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Назад')}><ArrowLeft size={18} /></button>
        <div><strong>{uiText('Стикеры')}</strong><small>{uiText('Паки для чата на ПК и телефоне')}</small></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      </header>
      <div className="admin-sheet-scroll">
        <form className="sticker-pack-new" onSubmit={(event) => { event.preventDefault(); void create() }}>
          <input className="input" value={name} maxLength={STICKER_LIMITS.name} onChange={(event) => setName(event.target.value)} placeholder={uiText('Название пака')} aria-label={uiText('Название пака')} />
          <button type="submit" className="button primary" disabled={busy || !name.trim()}><Plus size={16} />{uiText('Создать')}</button>
        </form>
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {!packs ? (error ? null : <AdminLoading />) : !packs.length ? <AdminEmpty text="Паков пока нет" /> : <div className="admin-list sticker-pack-list">
          {packs.map((entry, index) => <div key={entry.id} className="sticker-pack-row">
            <button type="button" className="sticker-pack-open" onClick={() => { setOpenId(entry.id); setError('') }}>
              <span className="sticker-pack-thumb">{entry.stickers[0] ? <img src={stickerPictureSrc(entry.stickers[0].id)} alt="" /> : <Sticker size={20} aria-hidden="true" />}</span>
              <span className="admin-row-copy"><strong>{entry.name}</strong><small>{stickersCount(entry.stickers.length)}</small></span>
              <span className={`sticker-pack-status${entry.published ? ' is-on' : ''}`}>{uiText(entry.published ? 'В приложениях' : 'Не добавлен')}</span>
              <ChevronRight size={17} />
            </button>
            <span className="sticker-pack-order">
              <button type="button" className="icon-button" disabled={busy || index === 0} aria-label={uiText(`Выше: ${entry.name}`)} onClick={() => void change(() => adminApi.orderStickerPacks(moved(ids, entry.id, -1)))}><ChevronUp size={16} /></button>
              <button type="button" className="icon-button" disabled={busy || index === ids.length - 1} aria-label={uiText(`Ниже: ${entry.name}`)} onClick={() => void change(() => adminApi.orderStickerPacks(moved(ids, entry.id, 1)))}><ChevronDown size={16} /></button>
            </span>
          </div>)}
        </div>}
        {error && !packs && <button type="button" className="button" onClick={() => setVersion((value) => value + 1)}>{uiText('Повторить')}</button>}
      </div>
    </section>
  </div>
}

/** One pack: «Добавить» / «Убрать», its stickers, «Новый стикер», rename and delete. */
function PackView({ pack, busy, error, change, onBack, onClose }: {
  pack: AdminStickerPack
  busy: boolean
  error: string
  change: (work: () => Promise<{ packs: AdminStickerPack[] }>) => Promise<boolean>
  onBack: () => void
  onClose: () => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState('')
  const ids = pack.stickers.map((sticker) => sticker.id)
  const full = pack.stickers.length >= STICKER_LIMITS.perPack
  const chosenIndex = chosen ? ids.indexOf(chosen) : -1

  const rename = async () => {
    const wanted = renaming?.trim()
    if (!wanted || wanted === pack.name) { setRenaming(null); return }
    if (await change(() => adminApi.updateStickerPack(pack.id, { name: wanted }))) setRenaming(null)
  }
  const publish = async (published: boolean) => {
    setSaved('')
    if (await change(() => adminApi.updateStickerPack(pack.id, { published }))) setSaved(published ? 'Пак добавлен в приложения' : 'Пак убран из приложений')
  }
  const removePack = async () => {
    if (!window.confirm(uiText(`Удалить пак «${pack.name}» со всеми стикерами?`))) return
    if (await change(() => adminApi.deleteStickerPack(pack.id))) onBack()
  }
  const removeSticker = async (id: string) => {
    if (!window.confirm(uiText('Удалить стикер?'))) return
    if (await change(() => adminApi.deleteSticker(id))) setChosen(null)
  }
  const save = async (png: string) => {
    // Refused: the editor stays open with the reason.
    const answer = await adminApi.addSticker(pack.id, png)
    await change(async () => answer)
    setEditing(false)
    setSaved('Стикер сохранён')
  }

  return <div className="admin-sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="panel admin-user-sheet" role="dialog" aria-modal="true" aria-label={pack.name}>
      <header className="admin-sheet-head">
        <button type="button" className="icon-button" onClick={onBack} aria-label={uiText('Все паки')}><ArrowLeft size={18} /></button>
        <div><strong>{pack.name}</strong><small>{stickersCount(pack.stickers.length)} · {uiText(pack.published ? 'В приложениях' : 'Не добавлен')}</small></div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      </header>
      <div className="admin-sheet-scroll">
        <div className={`sticker-pack-publish${pack.published ? ' is-on' : ''}`}>
          {pack.published
            ? <button type="button" className="button" disabled={busy} onClick={() => void publish(false)}><EyeOff size={16} />{uiText('Убрать')}</button>
            : <button type="button" className="button primary" disabled={busy} onClick={() => void publish(true)}><Eye size={16} />{uiText('Добавить')}</button>}
          <small>{uiText(pack.published ? (pack.stickers.length ? 'Игроки видят пак на ПК и телефоне' : 'Пустой пак игрокам не виден') : 'Добавить — пак появится у всех на ПК и телефоне')}</small>
        </div>
        {error && <div className="admin-inline-error" role="alert">{uiText(error)}</div>}
        {saved && !error && <div className="admin-inline-success" role="status">{uiText(saved)}</div>}

        <button type="button" className="button primary sticker-pack-add" disabled={busy || full} onClick={() => { setSaved(''); setEditing(true) }}><Plus size={17} />{uiText(full ? `Не больше ${STICKER_LIMITS.perPack} стикеров` : 'Новый стикер')}</button>
        {pack.stickers.length ? <div className="sticker-pack-grid" role="listbox" aria-label={uiText('Стикеры пака')}>
          {pack.stickers.map((sticker, index) => <button key={sticker.id} type="button" role="option" aria-selected={sticker.id === chosen} aria-label={uiText(`Стикер ${index + 1}`)}
            className={sticker.id === chosen ? 'is-chosen' : ''} onClick={() => setChosen((current) => (current === sticker.id ? null : sticker.id))}>
            <img src={stickerPictureSrc(sticker.id)} alt="" />
          </button>)}
        </div> : <AdminEmpty text="Стикеров пока нет" />}
        {chosen && chosenIndex >= 0 && <div className="sticker-pack-chosen" role="group" aria-label={uiText(`Стикер ${chosenIndex + 1}`)}>
          <button type="button" className="button small" disabled={busy || chosenIndex === 0} onClick={() => void change(() => adminApi.orderStickers(pack.id, moved(ids, chosen, -1)))}><ChevronLeft size={15} />{uiText('Левее')}</button>
          <button type="button" className="button small" disabled={busy || chosenIndex === ids.length - 1} onClick={() => void change(() => adminApi.orderStickers(pack.id, moved(ids, chosen, 1)))}>{uiText('Правее')}<ChevronRight size={15} /></button>
          <button type="button" className="button small danger" disabled={busy} onClick={() => void removeSticker(chosen)}><Trash2 size={15} />{uiText('Удалить')}</button>
        </div>}

        <div className="sticker-pack-manage">
          {renaming !== null
            ? <form className="sticker-pack-new" onSubmit={(event) => { event.preventDefault(); void rename() }}>
              <input className="input" value={renaming} maxLength={STICKER_LIMITS.name} autoFocus onChange={(event) => setRenaming(event.target.value)} aria-label={uiText('Название пака')} />
              <button type="submit" className="button primary" disabled={busy || !renaming.trim()}>{uiText('Сохранить')}</button>
              <button type="button" className="button ghost" onClick={() => setRenaming(null)}>{uiText('Отмена')}</button>
            </form>
            : <button type="button" className="button" disabled={busy} onClick={() => setRenaming(pack.name)}><Pencil size={15} />{uiText('Переименовать')}</button>}
          <button type="button" className="button danger" disabled={busy} onClick={() => void removePack()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />}{uiText('Удалить пак')}</button>
        </div>
      </div>
    </section>
    {editing && <Suspense fallback={<div className="admin-sheet-backdrop sticker-editor-backdrop" role="status" aria-label={uiText('Загружаем редактор…')}><LoaderCircle className="spin" size={26} /></div>}>
      <StickerEditor onCancel={() => setEditing(false)} onSave={save} />
    </Suspense>}
  </div>
}
