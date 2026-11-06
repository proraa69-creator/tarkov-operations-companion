import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, Ticket, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiLabel, uiText } from '../i18n/renderText'
import { markPromoCodesRead, unreadPromoCodes, usePromoCodes, usePromoRead, type PromoCode } from './promoCodes'
import './promo.css'

const MODES: Record<NonNullable<PromoCode['mode']>, string> = { pvp: 'PvP', pve: 'PvE', season: 'Сезон' }

function PromoRow({ row, isNew }: { row: PromoCode; isNew: boolean }) {
  const { locale } = useLocale()
  const [copied, setCopied] = useState(false)
  const date = new Date(row.addedAt).toLocaleString(locale === 'en' ? 'en' : 'ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  const copy = () => {
    void navigator.clipboard?.writeText(row.code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }
  return <li className={`promo-row${isNew ? ' is-new' : ''}`}>
    <code>{row.code}</code>
    {row.mode && <span className="tag">{uiText(MODES[row.mode])}</span>}
    <small>{uiText('Добавлен')} {date}</small>
    <button type="button" className="icon-button promo-copy" onClick={copy} title={uiLabel(copied ? 'Скопировано' : 'Скопировать')} aria-label={`${uiLabel('Скопировать')} ${row.code}`}>
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>
  </li>
}

/** Opening it reads everything (owner, 06.11.2026: «автоматически ставится статус… Не нужно, чтобы там была кнопка»); what was new keeps its frame while it stays open. */
function PromoDialog({ list, fresh, onClose }: { list: readonly PromoCode[]; fresh: ReadonlySet<string>; onClose: () => void }) {
  useEffect(() => { markPromoCodesRead(list) }, [list])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog promo-dialog" role="dialog" aria-modal="true" aria-labelledby="promo-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiLabel('Закрыть')}><X size={18} /></button>
        <h2 id="promo-title">{uiText('Промокоды')}</h2>
        {list.length
          ? <>
            <ul className="promo-list">{list.map((row) => <PromoRow key={row.code} row={row} isNew={fresh.has(row.code)} />)}</ul>
            <p className="promo-note">{uiText('Вводятся в лаунчере или на сайте игры.')}</p>
          </>
          : <p className="promo-empty">{uiText('Промокодов пока нет.')}</p>}
      </section>
    </div>,
    document.body,
  )
}

/** «Промокоды» in the Overview's header, with the red count of what is new, as on the news button. */
export function PromoCodesButton() {
  const list = usePromoCodes()
  const read = usePromoRead()
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null)
  const unread = unreadPromoCodes(list, read)
  const label = uiLabel('Промокоды')
  return <>
    <button type="button" className="button promo-button" aria-label={unread.length ? `${label}: ${unread.length}` : label} onClick={() => setFresh(new Set(unread.map((row) => row.code)))}>
      <Ticket size={16} aria-hidden="true" />{uiText(' Промокоды')}
      {unread.length > 0 && <span className="nav-badge" aria-hidden="true">{unread.length}</span>}
    </button>
    {fresh && <PromoDialog list={list} fresh={fresh} onClose={() => setFresh(null)} />}
  </>
}
