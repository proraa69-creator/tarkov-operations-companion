import { useEffect, useState } from 'react'
import { Clock3, DoorOpen, Hourglass, Moon, Sun } from 'lucide-react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { canonicalMapId } from '../data/mapIds'
import type { GameMap } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { formatClock, raidTimer, tarkovClocks } from '../overview/infoCardClock'
import { formatCountdown } from '../restock/restock'
import { RAID_LATE_MS, setExitsListOn, setExitsListOpen, setRaidClockOn, useExitsListOn, useExitsListOpen, useRaidClockOn, type RaidExitRow } from './raidInfoSettings'
import './raidInfo.css'

function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), interval)
    return () => window.clearInterval(timer)
  }, [interval])
  return now
}

/**
 * Under «Отложенные квесты» (report 239, owner 25.11.2026): the time in Tarkov, and in a raid what is left of it — red under 10
 * minutes. As on the Overview (overview/InfoStatCard.tsx): while the raid loads, or on a map whose time is not known, the time
 * since it began.
 */
export function MapRaidClock({ maps }: { maps: readonly Pick<GameMap, 'id' | 'name' | 'raidTime'>[] }) {
  const now = useNow(1000)
  const clocks = tarkovClocks(now)
  const local = useRaidState()
  const began = local && raidRunning(local, now) ? local.begun ?? local.since : undefined
  const mapId = local?.location ? canonicalMapId(local.location) : undefined
  const map = mapId ? maps.find((entry) => entry.id === mapId) : undefined
  const loading = Boolean(local && !local.begun)
  const timer = began ? raidTimer(began, map?.raidTime, now) : null
  const countsDown = Boolean(timer && timer.left !== undefined && !loading)
  const late = countsDown && timer!.left! < RAID_LATE_MS
  return (
    <div className="map-raid-clock">
      <div className="map-raid-clock-line" title={uiText('Время в Таркове')}>
        <Clock3 size={13} aria-hidden="true" />
        {clocks.map((clock, index) => (
          <span key={index} className={clock.night ? 'is-night' : undefined}>
            {clock.night ? <Moon size={12} aria-hidden="true" /> : <Sun size={12} aria-hidden="true" />}
            <strong className="mono">{formatClock(clock)}</strong>
          </span>
        ))}
      </div>
      {timer && (
        <div className={`map-raid-clock-line is-raid${late ? ' is-late' : ''}`} title={`${uiText('Сколько осталось времени до конца текущего рейда')}${map ? ` · ${uiText(map.name)}` : ''}`}>
          <Hourglass size={13} aria-hidden="true" />
          <span>{uiText(loading ? 'Загрузка рейда' : countsDown ? 'До конца рейда' : 'Идёт рейд')}</span>
          <strong className="mono">{countsDown ? (timer.left! > 0 ? formatCountdown(timer.left!) : uiText('время вышло')) : formatCountdown(timer.elapsed)}</strong>
        </div>
      )}
    </div>
  )
}

/**
 * «Выходы» under «Ключи» (report 239): the list stays open until it is pressed again. The exits the game listed this raid (a double
 * O, maps/raidExtracts.ts), every exit a flare opens and the car exit, there or not; nothing read yet — every exit of the side.
 */
export function MapExitsButton({ rows, scanned }: { rows: readonly RaidExitRow[]; scanned: boolean }) {
  const open = useExitsListOpen()
  const { locale } = useLocale()
  const label = uiText('Выходы')
  // The car exit's word (owner: «выход на машине пишется, есть или нет»); in English its own, not the app's «есть» = «have».
  const carState = (state: RaidExitRow['state']) => state === 'unknown' ? '?' : locale === 'en' ? (state === 'open' ? 'open' : 'closed') : state === 'open' ? 'есть' : 'нет'
  const listed = rows.filter((row) => row.state === 'open').length
  return (
    <div className="map-exits">
      <button type="button" className={`map-hud-keys map-exits-button${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setExitsListOpen(!open)}>
        <DoorOpen size={13} aria-hidden="true" />{label}{scanned ? <small>{listed}</small> : null}
      </button>
      {open && (
        <ul className="map-exits-list" aria-label={label}>
          {!scanned && <li className="map-exits-hint">{uiText('Дважды O в игре — выходы рейда')}</li>}
          {rows.map((row) => (
            <li key={row.id} className={`map-exits-row is-${row.state}`}>
              <span className="map-exits-dot" aria-hidden="true" />
              <span className="map-exits-name" title={uiText(row.title)}>{uiText(row.title)}</span>
              {row.flare && <small className="map-exits-tag is-flare">{uiText('сигнальный патрон')}</small>}
              {row.car && <small className="map-exits-tag is-car">{carState(row.state)}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return <div className="skill-timer-row">
    <span>{label}</span>
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><span /></button>
  </div>
}

/** «Настройки карты»: «Оставшееся время рейда» and «Список выходов» (owner, 25.11.2026), each on until turned off. */
export function MapRaidInfoSettings() {
  const clockOn = useRaidClockOn()
  const exitsOn = useExitsListOn()
  const clock = uiText('Оставшееся время рейда')
  const exits = uiText('Список выходов')
  return <>
    <div className="skill-timer-settings" role="group" aria-label={clock}>
      <div className="map-panels-menu-title">{clock}</div>
      <Switch label={uiText('На карте')} on={clockOn} onChange={setRaidClockOn} />
    </div>
    <div className="skill-timer-settings" role="group" aria-label={exits}>
      <div className="map-panels-menu-title">{exits}</div>
      <Switch label={uiText('На карте')} on={exitsOn} onChange={setExitsListOn} />
    </div>
  </>
}
