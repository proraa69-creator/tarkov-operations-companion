import { matchesSearchTerms, searchTerms } from '../shared/textSearch'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleHelp, KeyRound, Minus, Plus, Search, Star, Trash2, X } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { isKeyItem } from './keyScan'
import { setKeyUses, setOwnedKey, useKeyUses, useOwnedKeys } from './ownedKeys'
import { dropUnsureKeys, resolveUnsureKeys, useUnsureKeys } from './unsureKeys'

/** A dialog over the page: Escape and a click beside it close it. */
function Dialog({ title, className, onClose, children }: { title: string; className: string; onClose: () => void; children: React.ReactNode }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay quest-keys-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`panel registration-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId}>{uiText(title)}</h2>
        {children}
      </section>
    </div>,
    document.body,
  )
}

/**
 * The «?» beside «Найти ключи» (owner, 07.11.2026: «сделай кружок с вопросиком… по нажатию клавиши зайдите в игру и откройте
 * контейнер… Напиши контейнер или сумку. Где у вас лежат все ключи»).
 */
export function KeyScanHelp() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="icon-button quest-keys-help" aria-haspopup="dialog" aria-label={uiText('Как работает «Найти ключи»')} title={uiText('Как работает «Найти ключи»')} onClick={() => setOpen(true)}>
      <CircleHelp size={16} aria-hidden="true" />
    </button>
    {open && <Dialog title="Как работает «Найти ключи»" className="quest-keys-help-dialog" onClose={() => setOpen(false)}>
      <ol className="quest-keys-help-steps">
        <li>{uiText('Нажмите «Найти ключи».')}</li>
        <li>{uiText('Зайдите в игру и откройте контейнер или сумку, где у вас лежат все ключи.')}</li>
        <li>{uiText('Медленно листайте его: приложение читает названия ключей с экрана.')}</li>
        <li>{uiText('Найденные ключи попадут в «Ключи в схроне».')}</li>
      </ol>
      <p className="dim">{uiText('Поиск идёт 20 секунд, повторное нажатие его останавливает.')}</p>
    </Dialog>}
  </>
}

type Picked = ReadonlyMap<string, ReadonlyMap<string, number>>

/**
 * «Ключи под вопросом» (owner, 27.11.2026: «после конца сканирования открывается это окно автоматически и напиши: найдены ключи
 * с одинаковыми названиями… и предложи: выберите правильный ключ… выбираешь какой надо и нажимаешь галочку… какой и сколько
 * добавить. А которые не нужны, нажимаешь «Убрать»… снизу будет галочка «Ок»»): each label the last scan could not tell
 * (quests/unsureKeys.ts) with its keys, picture and full name. A tick picks a key — the pieces start at the cells seen not yet
 * given to another key of the label; «Убрать» drops the label at once; «Ок» puts the ticked keys in the stash and `onDone`.
 */
export function UnsureKeysDialog({ items, profileId, mode, onClose, onDone }: { items: Item[]; profileId: string; mode: RaidMode; onClose: () => void; onDone: () => void }) {
  const labels = useUnsureKeys(profileId, mode)
  const owned = useOwnedKeys(profileId, mode)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const [picked, setPicked] = useState<Picked>(() => new Map())
  const pick = (label: string, id: string, pieces: number) => setPicked((current) => {
    const next = new Map(current)
    const keys = new Map(current.get(label))
    if (pieces > 0) keys.set(id, pieces)
    else keys.delete(id)
    if (keys.size) next.set(label, keys)
    else next.delete(label)
    return next
  })
  const toggle = (label: string, id: string, seen: number) => {
    const keys = picked.get(label)
    if (keys?.has(id)) { pick(label, id, 0); return }
    const given = [...(keys?.values() ?? [])].reduce((sum, pieces) => sum + pieces, 0)
    pick(label, id, Math.max(1, seen - given))
  }
  const remove = (label: string) => {
    setPicked((current) => { const next = new Map(current); next.delete(label); return next })
    dropUnsureKeys(profileId, mode, [label])
  }
  const ok = () => {
    resolveUnsureKeys(profileId, mode, picked)
    onDone()
  }
  return <Dialog title="Ключи под вопросом" className="quest-keys-unsure-dialog" onClose={onClose}>
    <p className="quest-keys-unsure-lead">{uiText('Найдены ключи с одинаковыми названиями — выберите правильный ключ.')}</p>
    {labels.size > 0 && <ul className="quest-keys-unsure-list">{[...labels].map(([label, { ids, seen }]) => <li key={label} className="quest-keys-unsure-label">
      <div className="quest-keys-unsure-head">
        {/* ×2: two cells of it read; one says nothing (the reader takes a label once by its pixels: two alike may be one) */}
        <strong>«{uiText(label)}»{seen > 1 && <> <span className="quest-keys-unsure-seen">×{seen}</span></>}</strong>
        <button type="button" className="button small ghost" aria-label={`${uiText('Убрать')}: «${uiText(label)}»`} onClick={() => remove(label)}><Trash2 size={13} aria-hidden="true" />{uiText('Убрать')}</button>
      </div>
      <ul className="quest-keys-unsure-keys">{ids.map((id) => {
        const item = byId.get(id)
        const name = uiText(item?.name ?? id)
        const pieces = picked.get(label)?.get(id)
        const have = owned.get(id)
        return <li key={id} className={pieces ? 'is-picked' : ''}>
          <label className="quest-keys-unsure-pick">
            <input type="checkbox" checked={pieces !== undefined} aria-label={name} onChange={() => toggle(label, id, seen)} />
            <span className="quest-key-picture">{item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <KeyRound size={20} aria-hidden="true" />}</span>
            <span className="quest-keys-stash-name">
              <strong>{name}</strong>
              {have !== undefined && <small className="quest-keys-unsure-owned">{uiText('Есть в схроне')} · ×{have}</small>}
            </span>
          </label>
          {pieces !== undefined && <span className="quest-keys-stash-count">
            <button type="button" className="icon-button" aria-label={`${uiText('Минус один')}: ${name}`} disabled={pieces <= 1} onClick={() => pick(label, id, pieces - 1)}><Minus size={13} /></button>
            <b>×{pieces}</b>
            <button type="button" className="icon-button" aria-label={`${uiText('Плюс один')}: ${name}`} onClick={() => pick(label, id, pieces + 1)}><Plus size={13} /></button>
          </span>}
        </li>
      })}</ul>
    </li>)}</ul>}
    <div className="quest-keys-unsure-actions">
      <button type="button" className="button primary" onClick={ok}><Check size={15} aria-hidden="true" />{uiText('Ок')}</button>
    </div>
  </Dialog>
}

interface OwnedKeysProps { items: Item[]; needed: ReadonlySet<string>; profileId: string; mode: RaidMode; favoriteIds?: readonly string[] }

/** «Ключи в схроне» in a window of its own (kept for other pages; «Ключи для квестов» shows the panel in the page). */
export function OwnedKeysDialog({ onClose, ...props }: OwnedKeysProps & { onClose: () => void }) {
  return <Dialog title="Ключи в схроне" className="quest-keys-stash-dialog" onClose={onClose}><OwnedKeysPanel {...props} /></Dialog>
}

/**
 * «Ключи в схроне»: every key found by the scan or added by hand, how many and how many uses are left (the scan does not read uses: the
 * player sets them here), «Добавить вручную» from the catalog's keys. `needed`: the keys the quests still need, listed first. In the
 * page, not over it (owner, 11.11.2026: «Ключи в схроне нужно сделать не в отдельном окне, чтобы не всплывающее окно было»).
 */
export function OwnedKeysPanel({ items, needed, profileId, mode, favoriteIds = [] }: OwnedKeysProps) {
  const owned = useOwnedKeys(profileId, mode)
  const uses = useKeyUses(profileId, mode)
  const [adding, setAdding] = useState<false | 'search' | 'favorites'>(false)
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const rows = [...owned].map(([id, pieces]) => ({ id, pieces, item: byId.get(id) }))
    .sort((a, b) => Number(needed.has(b.id)) - Number(needed.has(a.id)) || uiText(a.item?.name ?? a.id).localeCompare(uiText(b.item?.name ?? b.id), 'ru'))
  const favorites = favoriteIds.flatMap((id) => { const item = byId.get(id); return item && isKeyItem(item) && !owned.has(id) ? [item] : [] })
  const terms = searchTerms(query)
  const found = query.trim().length < 2 ? [] : items.filter((item) => isKeyItem(item) && !owned.has(item.id)
    && matchesSearchTerms(terms, uiText(item.name ?? ''), uiText(item.shortName ?? ''))).slice(0, 30)
  return <div className="quest-keys-stash-panel">
    <div className="quest-keys-stash-bar">
      <span className="dim">{uiText('Найдено ключей')}: <strong>{rows.length}</strong></span>
      <span className="quest-keys-stash-actions">
        <button type="button" className={`button small${adding === 'search' ? ' primary' : ''}`} aria-pressed={adding === 'search'} onClick={() => setAdding((value) => value === 'search' ? false : 'search')}><Plus size={14} aria-hidden="true" />{uiText('Добавить вручную')}</button>
        {/* Owner, 10.11.2026: «кнопка … «Добавить из избранного», открывается список избранного… нажимаешь плюсик и добавляешь». */}
        <button type="button" className={`button small${adding === 'favorites' ? ' primary' : ''}`} aria-pressed={adding === 'favorites'} onClick={() => setAdding((value) => value === 'favorites' ? false : 'favorites')}><Star size={14} aria-hidden="true" />{uiText('Добавить из избранного')}</button>
      </span>
    </div>
    {adding === 'favorites' && <div className="quest-keys-stash-add">
      {favorites.length > 0
        ? <ul className="quest-keys-stash-found">{favorites.map((item) => <li key={item.id}>
          <button type="button" aria-label={`${uiText('Добавить')}: ${uiText(item.name)}`} onClick={() => setOwnedKey(profileId, mode, item.id, 1)}>
            {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={18} aria-hidden="true" />}
            <span>{uiText(item.name)}</span>{needed.has(item.id) && <span className="tag brass">{uiText('нужен')}</span>}<Plus size={14} aria-hidden="true" />
          </button>
        </li>)}</ul>
        : <p className="dim">{uiText('В «Избранном» нет ключей, которых нет в схроне.')}</p>}
    </div>}
    {adding === 'search' && <div className="quest-keys-stash-add">
      <label className="quest-keys-search"><Search size={15} aria-hidden="true" /><input className="input" autoFocus value={query} placeholder={uiText('Название ключа…')} aria-label={uiText('Название ключа…')} onChange={(event) => setQuery(event.target.value)} /></label>
      {found.length > 0 && <ul className="quest-keys-stash-found">{found.map((item) => <li key={item.id}>
        <button type="button" onClick={() => { setOwnedKey(profileId, mode, item.id, 1); setQuery('') }}>
          {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={18} aria-hidden="true" />}
          <span>{uiText(item.name)}</span>{needed.has(item.id) && <span className="tag brass">{uiText('нужен')}</span>}<Plus size={14} aria-hidden="true" />
        </button>
      </li>)}</ul>}
      {query.trim().length >= 2 && !found.length && <p className="dim">{uiText('Ничего не найдено.')}</p>}
    </div>}
    {rows.length === 0
      ? <p className="dim quest-keys-stash-empty">{uiText('Пока пусто. Нажмите «Найти ключи» или добавьте ключи вручную.')}</p>
      : <ul className="quest-keys-stash-list">{rows.map(({ id, pieces, item }) => {
        const max = item?.keyUses && item.keyUses > 0 ? item.keyUses : undefined
        const left = uses.get(id)
        return <li key={id}>
          <span className="quest-key-picture">{item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <KeyRound size={20} aria-hidden="true" />}</span>
          <span className="quest-keys-stash-name">
            <strong>{uiText(item?.name ?? id)}</strong>
            {needed.has(id) && <small className="quest-keys-stash-needed">{uiText('нужен для квестов')}</small>}
          </span>
          {max !== undefined && <label className="quest-keys-stash-uses" title={uiText('Сколько использований осталось')}>
            <input className="input" type="number" min={0} max={max} value={left ?? ''} placeholder={String(max)} aria-label={`${uiText('Осталось использований')}: ${uiText(item?.name ?? id)}`}
              onChange={(event) => setKeyUses(profileId, mode, id, event.target.value === '' ? undefined : Math.min(max, Number(event.target.value)))} />
            <small>/ {max}</small>
          </label>}
          <span className="quest-keys-stash-count">
            <button type="button" className="icon-button" aria-label={uiText('Минус один')} onClick={() => setOwnedKey(profileId, mode, id, pieces - 1)}><Minus size={13} /></button>
            <b>×{pieces}</b>
            <button type="button" className="icon-button" aria-label={uiText('Плюс один')} onClick={() => setOwnedKey(profileId, mode, id, pieces + 1)}><Plus size={13} /></button>
          </span>
          <button type="button" className="icon-button" aria-label={`${uiText('Убрать')}: ${uiText(item?.name ?? id)}`} title={uiText('Убрать')} onClick={() => setOwnedKey(profileId, mode, id, 0)}><Trash2 size={14} /></button>
        </li>
      })}</ul>}
  </div>
}
