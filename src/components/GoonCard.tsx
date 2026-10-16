import { useEffect, useRef, useState } from 'react'
import { useBlockTitle } from '../overview/blockTitle'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { GOON_MAPS, GOON_RETRY_UNSENT_MS, useGoonTracker, type GoonMapId, type GoonReportResult } from '../data/goonTracker'
import type { RaidMode } from '../domain/types'
import './goonCard.css'
import goonLying from '../assets/goons-rest/lying.webp'

interface GoonCardProps {
  mode: RaidMode
  /** Localised map names by map id (customs, woods…). */
  mapName: (mapId: string) => string
}

const NOTICE: Record<GoonReportResult, string> = {
  sent: 'Отметка отправлена',
  duplicate: 'Вы уже отмечали эту карту',
  unsent: 'Не отправлено · сохранено локально',
  later: 'Слишком часто: отметка уйдёт сама через минуту',
  local: 'Сохранено только на этом компьютере',
  signin: 'Войдите в аккаунт, чтобы отметить',
  nickname: 'Ник появится, когда приложение прочитает логи игры',
}

/**
 * Goons (Кочевники) stat card. Everything that opens here is absolutely positioned,
 * so the card and the rest of the dashboard never move or resize. The 5-hour statistics cover the card exactly, never
 * more (owner, 12.10.2026); with the pointer over them the wheel scrolls «кто видел», not the page.
 */
export function GoonCard({ mode, mapName }: GoonCardProps) {
  const { locale } = useLocale()
  const title = useBlockTitle('Кочевники')
  const { location, stats, recent, connection, now, reportSighting } = useGoonTracker(mode)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmMap, setConfirmMap] = useState<GoonMapId | null>(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<GoonReportResult | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const recentRef = useRef<HTMLUListElement>(null)

  const closeMenu = (restoreFocus = false) => {
    setMenuOpen(false)
    setConfirmMap(null)
    if (restoreFocus) buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (event: PointerEvent) => { if (!cardRef.current?.contains(event.target as Node)) { setMenuOpen(false); setConfirmMap(null) } }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setMenuOpen(false); setConfirmMap(null); buttonRef.current?.focus() } }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey) }
  }, [menuOpen])

  // Anywhere over the statistics the wheel scrolls the sightings list (a non-passive listener: React's onWheel cannot
  // stop the page from scrolling), a row at a time so no nickname is cut in half: a mouse notch (~100 px) moves two
  // rows, a touchpad one row per 50 px it adds up. A list that fits leaves the wheel to the page. The list is exactly as
  // tall as the whole rows that fit (themes differ in card height), so the last visible one is never cut either.
  const hasRecent = recent.length > 0
  useEffect(() => {
    const stats = statsRef.current
    if (!stats || !hasRecent) return
    let pending = 0
    const onWheel = (event: WheelEvent) => {
      const list = recentRef.current
      if (!list || list.scrollHeight <= list.clientHeight || !event.deltaY) return
      event.preventDefault()
      const step = rowStep(list)
      const pixels = event.deltaY * (event.deltaMode === 1 ? step : event.deltaMode === 2 ? list.clientHeight : 1)
      if (Math.sign(pixels) !== Math.sign(pending)) pending = 0
      pending += pixels
      const rows = Math.trunc(pending / 50)
      if (!rows) return
      pending -= rows * 50
      list.scrollTop = Math.round(list.scrollTop / step + rows) * step
    }
    const fit = () => {
      const list = recentRef.current
      if (!list) return
      list.style.height = ''
      const step = rowStep(list)
      list.style.height = `${Math.max(step, Math.floor(list.clientHeight / step) * step)}px`
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit)
    observer?.observe(stats)
    fit()
    stats.addEventListener('wheel', onWheel, { passive: false })
    return () => { observer?.disconnect(); stats.removeEventListener('wheel', onWheel) }
  }, [hasRecent])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])

  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  const ago = (iso: string) => {
    const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
    if (minutes < 1) return uiText('только что')
    if (minutes < 60) return `${minutes} ${uiText('мин назад')}`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} ${uiText('ч назад')}`
    return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
  }

  const confirm = async () => {
    if (!confirmMap || sending) return
    setSending(true)
    const result = await reportSighting(confirmMap).catch((): GoonReportResult => 'unsent')
    setSending(false)
    setNotice(result)
    closeMenu(true)
  }

  const statFor = (mapId: GoonMapId) => stats.find((row) => row.mapId === mapId)
  const top = stats[0]
  const lastSeen = stats.reduce<string | null>((latest, row) => !latest || row.lastAt > latest ? row.lastAt : latest, null) ?? location?.reportedAt ?? null
  const connectionNote = connection === 'offline' ? 'сервер недоступен' : connection === 'local-only' ? 'локальный режим' : 'обновление каждые 30 с'

  // An unsent sighting goes again with every refresh for a while (spam protection, a short outage): «отправится позже».
  const resending = Boolean(location?.unsent && connection !== 'local-only' && now - Date.parse(location.reportedAt) < GOON_RETRY_UNSENT_MS)
  const meta = notice
    ? uiText(NOTICE[notice])
    : location
      ? `${location.nickname ? `${uiText('видел')} ${location.nickname}` : uiText('крайний раз')} · ${time(location.reportedAt)} · ${ago(location.reportedAt)}`
      : uiText(connectionNote)

  return <div ref={cardRef} className={`stat-card goon-card ${menuOpen ? 'is-open' : ''}`}>
    <div className="goon-card-heading">
      <div className="stat-label">{title}</div>
      <div className="goon-report-anchor">
        <button ref={buttonRef} type="button" className="button small goon-report-button" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => (menuOpen ? closeMenu() : setMenuOpen(true))}>{uiText('Видел')}</button>
        {menuOpen && <div className="goon-report-menu" role="dialog" aria-label={uiText('Где видели Кочевников?')}>
          {confirmMap
            ? <div className="goon-report-confirm">
              <p>{uiText('Отправить: Кочевники на карте')} <strong>{uiText(mapName(confirmMap))}</strong>?</p>
              <div className="goon-report-actions">
                <button type="button" className="button small primary" disabled={sending} autoFocus onClick={() => void confirm()}>{uiText(sending ? 'Отправка…' : 'Подтвердить')}</button>
                <button type="button" className="button small" disabled={sending} onClick={() => setConfirmMap(null)}>{uiText('Отмена')}</button>
              </div>
            </div>
            : <>
              <div className="goon-report-title">{uiText('Где видели Кочевников?')}</div>
              <div className="goon-report-list">
                {GOON_MAPS.map((id, index) => <button type="button" key={id} className="goon-report-option" autoFocus={index === 0} onClick={() => setConfirmMap(id)}>{uiText(mapName(id))}</button>)}
              </div>
            </>}
        </div>}
      </div>
    </div>
    {/* A new value remounts (key) so it slides up into place. */}
    <div className="stat-value goon-map-value"><span key={location?.mapId ?? 'none'} className="goon-rise">{uiText(location ? mapName(location.mapId) : 'Нет данных')}</span></div>
    <div className={`stat-meta goon-meta ${location?.unsent && !notice ? 'is-unsent' : ''}`} aria-live="polite">
      <span key={`${location?.reportedAt ?? ""}:${notice ?? ""}:${connection}`} className="goon-rise is-late">{meta}</span>{location?.unsent && !notice && <em className="goon-rise is-late">{uiText(resending ? 'отправится позже' : 'не отправлено')}</em>}
    </div>

    {/* A Goon lies at the card's right while the map name shows; the statistics rising over the card carry him away
        (owner, 16.10.2026: «когда видно название карты он лежит в правой части. когда наводишь мышку он уезжает с этим
        блоком»). */}
    <span className="goon-lying-frame" aria-hidden="true"><img className="goon-lying" src={goonLying} alt="" draggable={false} /></span>

    <div ref={statsRef} className="goon-stats-popover" aria-hidden="true">
      <div className="goon-stats-head">
        <span className="stat-label">{uiText('Кочевники · 5 часов')}</span>
        <span>{top ? <>{uiText('Чаще всего:')} <strong>{uiText(mapName(top.mapId))}</strong></> : uiText('Отметок нет')}</span>
      </div>
      <div className="goon-stats-grid">
        {GOON_MAPS.map((id) => {
          const row = statFor(id)
          return <div key={id} className={`goon-stats-cell ${row && row.mapId === top?.mapId ? 'is-top' : ''} ${row ? '' : 'is-empty'}`}>
            <span>{uiText(mapName(id))}</span><b>{row?.count ?? 0}</b>
          </div>
        })}
      </div>
      {recent.length > 0
        ? <ul ref={recentRef} className="goon-recent">
          {recent.map((entry) => <li key={`${entry.reportedAt}:${entry.mapId}:${entry.nickname ?? ''}`}>
            <b>{entry.nickname ?? uiText('игрок')}</b><span>{uiText(mapName(entry.mapId))}</span><time dateTime={entry.reportedAt}>{time(entry.reportedAt)}</time>
          </li>)}
        </ul>
        : <div className="goon-stats-foot">
          {lastSeen ? <>{uiText('Последний раз:')} {time(lastSeen)} · {ago(lastSeen)}</> : uiText(connectionNote)}
        </div>}
    </div>
  </div>
}

/** Distance from one sightings row to the next (row height and gap); 14 px while the rows are not laid out. */
function rowStep(list: HTMLElement) {
  const first = list.firstElementChild as HTMLElement | null
  const second = first?.nextElementSibling as HTMLElement | null
  const step = first && second ? second.offsetTop - first.offsetTop : first?.offsetHeight ?? 0
  return step > 0 ? step : 14
}
