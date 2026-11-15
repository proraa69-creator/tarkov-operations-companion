import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock3, Hourglass, Moon, Settings2, Sun, Timer } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatCountdown, msUntilRestock } from '../restock/restock'
import { useTraderResets } from '../restock/restockSource'
import { ScreenStatCard } from '../screen/ScreenStatCard'
import { useRemoteScreen } from '../screen/screenRemote'
import { useAppState } from '../state/AppState'
import { formatClock, formatSpan, raidTimer, setInfoCardView, tarkovClocks, useInfoCardView, useLastRaid, type InfoCardView } from './infoCardClock'
import './infoCard.css'

/** Re-renders every `interval` ms while the window is in use (src/app/activePolling.ts). */
function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => startActivePolling(() => setNow(Date.now()), { activeEveryMs: interval, followFocus: Boolean(window.tarkovDesktop) }), [interval])
  return now
}

const VIEW_NAMES: Record<InfoCardView, string> = {
  'tarkov-time': 'Время в Таркове',
  restock: 'Сброс торговцев',
  'raid-timer': 'Таймер рейда',
  screen: 'Пресеты экрана',
}

/** The small square gear: what this block shows (owner, 15.11.2026: «кнопка маленькая, квадратная, настроек»). */
function ViewChooser({ phone, view }: { phone: boolean; view: InfoCardView }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [open])
  const views: InfoCardView[] = phone ? ['tarkov-time', 'restock', 'raid-timer', 'screen'] : ['tarkov-time', 'restock', 'raid-timer']
  const label = uiText('Что показывать')
  return (
    <div className="info-card-chooser" ref={root}>
      <button type="button" className="icon-button info-card-gear" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((state) => !state)}>
        <Settings2 size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="info-card-menu" role="menu" aria-label={label}>
          {views.map((entry) => (
            <button key={entry} type="button" role="menuitemradio" aria-checked={entry === view} className={entry === view ? 'is-active' : ''}
              onClick={() => { setInfoCardView(entry); setOpen(false) }}>
              <span>{uiText(VIEW_NAMES[entry])}</span>
              {entry === view && <Check size={13} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Card({ icon, title, chooser, children, className = '' }: { icon: ReactNode; title: string; chooser: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`stat-card info-stat-card ${className}`}>
      <div className="info-card-head">
        <div className="stat-label">{icon} {uiText(title)}</div>
        {chooser}
      </div>
      {children}
    </div>
  )
}

/** «Время в Таркове»: both clocks of the raid selection, day or night, and when that changes. */
function TarkovTime({ chooser }: { chooser: ReactNode }) {
  const now = useNow(1000)
  const { locale } = useLocale()
  const clocks = tarkovClocks(now)
  return (
    <Card icon={<Clock3 size={12} aria-hidden="true" />} title="Время в Таркове" chooser={chooser} className="info-tarkov-time">
      <div className="info-clocks">
        {clocks.map((clock, index) => (
          <div key={index} className={`info-clock${clock.night ? ' is-night' : ''}`}>
            {clock.night ? <Moon size={14} aria-hidden="true" /> : <Sun size={14} aria-hidden="true" />}
            <strong className="mono">{formatClock(clock)}</strong>
            <small>{uiText(clock.night ? 'день через' : 'ночь через')} {formatSpan(clock.untilChange, locale === 'en' ? 'en' : 'ru')}</small>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** «Сброс торговцев»: the next restocks, the nearest first. */
function Restock({ chooser }: { chooser: ReactNode }) {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const now = useNow(1000)
  const { data, isLoading } = useTraderResets(raidMode, locale, true)
  const next = (data ?? [])
    .map((trader) => ({ trader, left: msUntilRestock(trader, now) }))
    .filter((entry): entry is { trader: typeof entry.trader; left: number } => entry.left !== undefined && entry.left > -60_000)
    .sort((a, b) => a.left - b.left)
    .slice(0, 3)
  return (
    <Card icon={<Timer size={12} aria-hidden="true" />} title="Сброс торговцев" chooser={chooser} className="info-restock">
      {next.length ? (
        <button type="button" className="info-restock-list" onClick={() => navigate('/traders')} aria-label={uiText('Торговцы')}>
          {next.map(({ trader, left }, index) => (
            <span key={trader.id} className={`info-restock-row${index === 0 ? ' is-next' : ''}`}>
              <span>{uiText(trader.name)}</span>
              <strong className="mono">{left <= 0 ? uiText('сейчас') : formatCountdown(left)}</strong>
            </span>
          ))}
        </button>
      ) : <div className="info-empty">{uiText(isLoading ? 'Загрузка…' : 'Нет данных о сбросе')}</div>}
    </Card>
  )
}

/** «Таймер рейда»: in a raid, since it began and what is left of the map's time; between raids, the raid before. */
function RaidClock({ chooser }: { chooser: ReactNode }) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const now = useNow(1000)
  const local = useRaidState()
  const last = useLastRaid()
  const raid = local && raidRunning(local, now) ? { began: local.begun ?? local.since, location: local.location, loading: !local.begun } : null
  const mapOf = (location?: string) => {
    const id = location ? canonicalMapId(location) : undefined
    return id ? data.maps.find((map) => map.id === id) : undefined
  }
  const lang = locale === 'en' ? 'en' : 'ru'
  if (raid?.began) {
    const map = mapOf(raid.location)
    const timer = raidTimer(raid.began, map?.raidTime, now)
    return (
      <Card icon={<Hourglass size={12} aria-hidden="true" />} title="Таймер рейда" chooser={chooser} className="info-raid is-live">
        <div className="info-raid-map">{map ? uiText(map.name) : uiText('Рейд')}{raid.loading && <small> · {uiText('загрузка')}</small>}</div>
        <strong className="info-raid-elapsed mono">{formatCountdown(timer.elapsed)}</strong>
        {timer.left !== undefined && !raid.loading && (
          <small className={`info-raid-left${timer.left < 5 * 60_000 ? ' is-late' : ''}`}>{uiText(timer.left > 0 ? 'осталось' : 'время вышло')} {timer.left > 0 ? formatSpan(timer.left, lang) : ''}</small>
        )}
      </Card>
    )
  }
  const lastMap = last ? mapOf(last.location) : undefined
  return (
    <Card icon={<Hourglass size={12} aria-hidden="true" />} title="Таймер рейда" chooser={chooser} className="info-raid">
      <div className="info-empty">{uiText('Рейд не идёт')}</div>
      {last && (
        <small className="info-raid-last">{uiText('Прошлый рейд')}: {lastMap ? uiText(lastMap.name) : '—'} · {formatSpan(last.ended - last.began, lang)}</small>
      )}
    </Card>
  )
}

/**
 * The Overview's first small block: «Время в Таркове», «Сброс торговцев», «Таймер рейда», and on the phone its «Пресеты экрана» too
 * (owner, 15.11.2026). The square gear picks; the choice stays on this device.
 */
export function InfoStatCard({ phone }: { phone: boolean }) {
  const view = useInfoCardView(phone)
  const chooser = <ViewChooser phone={phone} view={view} />
  if (view === 'screen') return <ScreenStatCard chooser={chooser} />
  if (view === 'restock') return <Restock chooser={chooser} />
  if (view === 'raid-timer') return phone ? <PhoneRaidClock chooser={chooser} /> : <RaidClock chooser={chooser} />
  return <TarkovTime chooser={chooser} />
}

/** The phone's raid timer: what the PC said last (its screen relay, src/screen/screenRemote.ts). */
function PhoneRaidClock({ chooser }: { chooser: ReactNode }) {
  const { pc } = useRemoteScreen()
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const now = useNow(1000)
  const began = pc?.state.raidBegun
  const map = pc?.state.raidLocation ? data.maps.find((entry) => entry.id === canonicalMapId(pc.state.raidLocation!)) : undefined
  if (began && pc?.state.inRaid) {
    const timer = raidTimer(began, map?.raidTime, now)
    return (
      <Card icon={<Hourglass size={12} aria-hidden="true" />} title="Таймер рейда" chooser={chooser} className="info-raid is-live">
        <div className="info-raid-map">{map ? uiText(map.name) : uiText('Рейд')}</div>
        <strong className="info-raid-elapsed mono">{formatCountdown(timer.elapsed)}</strong>
        {timer.left !== undefined && <small className={`info-raid-left${timer.left < 5 * 60_000 ? ' is-late' : ''}`}>{uiText(timer.left > 0 ? 'осталось' : 'время вышло')} {timer.left > 0 ? formatSpan(timer.left, locale === 'en' ? 'en' : 'ru') : ''}</small>}
      </Card>
    )
  }
  return (
    <Card icon={<Hourglass size={12} aria-hidden="true" />} title="Таймер рейда" chooser={chooser} className="info-raid">
      <div className="info-empty">{uiText(pc ? 'Рейд не идёт' : 'Нет связи с ПК')}</div>
    </Card>
  )
}
