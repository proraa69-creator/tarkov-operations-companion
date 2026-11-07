import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CircleHelp, KeyRound, Minus, Plus, Search, Trash2, X } from 'lucide-react'
import type { Item, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { isKeyItem } from './keyScan'
import { setKeyUses, setOwnedKey, useKeyUses, useOwnedKeys } from './ownedKeys'

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
        <li>{uiText('Найденные ключи попадут в «Ключи в схроне», а нужные для квестов отметятся «Есть в игре».')}</li>
      </ol>
      <p className="dim">{uiText('Поиск идёт 45 секунд, повторное нажатие его останавливает. Ключ не нашёлся — добавьте его вручную в «Ключи в схроне».')}</p>
    </Dialog>}
  </>
}

/**
 * «Ключи в схроне»: every key found by the scan or added by hand, how many and how many uses are left (the scan does not read uses: the
 * player sets them here), «Добавить вручную» from the catalog's keys. `needed`: the keys the quests still need, listed first.
 */
export function OwnedKeysDialog({ items, needed, profileId, mode, onClose }: { items: Item[]; needed: ReadonlySet<string>; profileId: string; mode: RaidMode; onClose: () => void }) {
  const owned = useOwnedKeys(profileId, mode)
  const uses = useKeyUses(profileId, mode)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const rows = [...owned].map(([id, pieces]) => ({ id, pieces, item: byId.get(id) }))
    .sort((a, b) => Number(needed.has(b.id)) - Number(needed.has(a.id)) || uiText(a.item?.name ?? a.id).localeCompare(uiText(b.item?.name ?? b.id), 'ru'))
  const needle = query.trim().toLowerCase()
  const found = needle.length < 2 ? [] : items.filter((item) => isKeyItem(item) && !owned.has(item.id)
    && [item.name, item.shortName].some((text) => uiText(text ?? '').toLowerCase().includes(needle))).slice(0, 30)
  return <Dialog title="Ключи в схроне" className="quest-keys-stash-dialog" onClose={onClose}>
    <div className="quest-keys-stash-bar">
      <span className="dim">{uiText('Найдено ключей')}: <strong>{rows.length}</strong></span>
      <button type="button" className={`button small${adding ? ' primary' : ''}`} aria-pressed={adding} onClick={() => setAdding((value) => !value)}><Plus size={14} aria-hidden="true" />{uiText('Добавить вручную')}</button>
    </div>
    {adding && <div className="quest-keys-stash-add">
      <label className="quest-keys-search"><Search size={15} aria-hidden="true" /><input className="input" autoFocus value={query} placeholder={uiText('Название ключа…')} aria-label={uiText('Название ключа…')} onChange={(event) => setQuery(event.target.value)} /></label>
      {found.length > 0 && <ul className="quest-keys-stash-found">{found.map((item) => <li key={item.id}>
        <button type="button" onClick={() => { setOwnedKey(profileId, mode, item.id, 1); setQuery('') }}>
          {item.iconUrl ? <img src={item.iconUrl} alt="" /> : <KeyRound size={18} aria-hidden="true" />}
          <span>{uiText(item.name)}</span>{needed.has(item.id) && <span className="tag brass">{uiText('нужен')}</span>}<Plus size={14} aria-hidden="true" />
        </button>
      </li>)}</ul>}
      {needle.length >= 2 && !found.length && <p className="dim">{uiText('Ничего не найдено.')}</p>}
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
  </Dialog>
}
