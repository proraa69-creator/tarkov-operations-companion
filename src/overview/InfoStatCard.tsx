import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Clock3, History, Hourglass, Moon, RefreshCw, Settings2, Sun, Timer } from 'lucide-react'
import { startActivePolling } from '../app/activePolling'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useTarkovData } from '../data/DataProvider'
import { canonicalMapId } from '../data/mapIds'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatCountdown, msUntilRestock } from '../restock/restock'
import { useTraderResets } from '../restock/restockSource'
import { useRestockSettings } from '../restock/restockSettings'
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

/**
 * «Время в Таркове», one block for all (owner, 19.11.2026: «цифры маленькие, сделай их больше… объединить все в одно. Время в
 * Таркове. Ниже пиши сброс торговцев, которые выбраны… все торговцы не выбраны, пиши таймер рейда… сколько осталось… когда
 * человек не в рейде, пиши прошлый рейд, таможня, сколько-то минут… Сделай все в одном стиле»): the two clocks large; under them
 * the resets of the traders picked in Settings («Уведомления о рестоке»); then the raid — what is left of it, or the raid before.
 * Owner, 25.11.2026: in a raid «между временем в Таркове и прошлым рейдом появляется надпись „Сколько осталось времени до конца
 * текущего рейда“», and the raid before moves a line down.
 */
function TarkovTime({ chooser, phone }: { chooser: ReactNode; phone: boolean }) {
  const now = useNow(1000)
  const clocks = tarkovClocks(now)
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const { data } = useTarkovData()
  const navigate = useNavigate()
  const picked = useRestockSettings().traderIds
  const resetsQuery = useTraderResets(raidMode, locale, picked.length > 0)
  const resets = resetsQuery.data ?? []
  const local = useRaidState()
  const last = useLastRaid()
  const lang = locale === 'en' ? 'en' : 'ru'
  const mapOf = (location?: string) => {
    const id = location ? canonicalMapId(location) : undefined
    return id ? data.maps.find((map) => map.id === id) : undefined
  }
  const traders = resets
    .filter((trader) => picked.includes(trader.id))
    .map((trader) => ({ trader, left: msUntilRestock(trader, now) }))
    .filter((entry): entry is { trader: typeof entry.trader; left: number } => entry.left !== undefined && entry.left > -60_000)
    .sort((a, b) => a.left - b.left)
    .slice(0, 3)
  // The picked traders' resets come from the network after the first frame; on the phone a cold load keeps a row for each
  // (defensive, phone «Обзор» jitter), so their arrival fills the reserved place instead of pushing the blocks below down.
  // A cached answer has the rows at once (nothing reserved); an empty pick, or the desktop, reserve nothing.
  const reservedResetRows = phone && picked.length > 0 && traders.length === 0 && resetsQuery.isLoading ? Math.min(picked.length, 3) : 0
  const raid = local && raidRunning(local, now) && (local.begun ?? local.since) ? { began: (local.begun ?? local.since)!, map: mapOf(local.location), loading: !local.begun } : null
  const timer = raid ? raidTimer(raid.began, raid.map?.raidTime, now) : null
  // What is left of the map's time once the raid has begun (owner, 25.11.2026); while it loads, or on a map whose time is not
  // known, the time since it began.
  const countsDown = Boolean(raid && timer && timer.left !== undefined && !raid.loading)
  const lastMap = last ? mapOf(last.location) : undefined
  return (
    <Card icon={<Clock3 size={12} aria-hidden="true" />} title="Время в Таркове" chooser={chooser} className="info-tarkov-time is-combined">
      <div className="info-clocks">
        {clocks.map((clock, index) => (
          <div key={index} className={`info-clock${clock.night ? ' is-night' : ''}`}>
            {clock.night ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
            <strong className="mono">{formatClock(clock)}</strong>
          </div>
        ))}
      </div>
      <div className="info-lines">
        {Array.from({ length: reservedResetRows }, (_, index) => (
          <span key={`reset-reserve-${index}`} className="info-line is-skeleton" aria-hidden="true">
            <RefreshCw size={13} aria-hidden="true" /><span>&nbsp;</span><strong className="mono">&nbsp;</strong>
          </span>
        ))}
        {traders.map(({ trader, left }) => (
          <button key={trader.id} type="button" className="info-line" onClick={() => navigate('/traders')} title={uiText('Сброс торговцев')}>
            <RefreshCw size={13} aria-hidden="true" /><span>{uiText(trader.name)}</span><strong className="mono">{left <= 0 ? uiText('сейчас') : formatCountdown(left)}</strong>
          </button>
        ))}
        {raid && timer && (
          <div className={`info-line is-raid${countsDown && timer.left! < 5 * 60_000 ? ' is-late' : ''}`}
            title={`${uiText('Сколько осталось времени до конца текущего рейда')}${raid.map ? ` · ${uiText(raid.map.name)}` : ''}`}>
            <Hourglass size={13} aria-hidden="true" />
            <span>{uiText(raid.loading ? 'Загрузка рейда' : countsDown ? 'До конца рейда' : 'Идёт рейд')}</span>
            <strong className="mono">{countsDown ? (timer.left! > 0 ? formatCountdown(timer.left!) : uiText('время вышло')) : formatCountdown(timer.elapsed)}</strong>
          </div>
        )}
        {last && (
          <div className="info-line is-last">
            <History size={13} aria-hidden="true" />
            <span>{uiText('Прошлый рейд')} · {lastMap ? uiText(lastMap.name) : '—'}</span>
            <strong className="mono">{formatSpan(last.ended - last.began, lang)}</strong>
          </div>
        )}
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
  return <TarkovTime chooser={chooser} phone={phone} />
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
