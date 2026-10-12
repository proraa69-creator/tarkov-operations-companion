import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { EyeOff, LoaderCircle, UserRound, X } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { fetchFriendInfo, type FriendInfo } from './socialClient'
import { ErrorLine } from './squadUi'
import { modeLabel } from './squadLabels'

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/**
 * «Информация о друге» (owner, 12.10.2026: «уровни во всех режимах, значок пристижа, пристижи должны отличаться 1 2 3 4»):
 * level and prestige in every mode, from the public game profile of the game account the friend's app synced (the
 * server looks it up; the account id never reaches this app). Opened by the square button on the friend's row.
 */
export function FriendInfoDialog({ friendId, name, color, onClose }: { friendId: string; name: string; color?: string; onClose: () => void }) {
  const [info, setInfo] = useState<FriendInfo | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    fetchFriendInfo(friendId).then((answer) => { if (active) setInfo(answer) }, (reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { active = false }
  }, [friendId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const shown = info && !info.hidden
  const known = shown ? MODES.filter((mode) => info.modes[mode]) : []
  const style = (color ? { '--friend': color } : {}) as CSSProperties
  return createPortal(<div className="registration-overlay support-overlay" role="dialog" aria-modal="true" aria-label={`${uiText('Информация о друге')} ${name}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog friend-info-dialog" style={style} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className="friend-info-head">
        <span className="friend-info-avatar"><UserRound size={24} /></span>
        <span><small>{uiText('Информация об аккаунте')}</small><h2>{name}</h2></span>
      </div>
      {!info && !error && <p className="muted friend-info-wait"><LoaderCircle className="spin" size={16} />{uiText('Загружаем профиль…')}</p>}
      <ErrorLine message={error} />
      {info?.hidden && <p className="muted friend-info-wait"><EyeOff size={15} />{uiText('Друг скрыл от вас прогресс — уровни не показываются.')}</p>}
      {shown && <div className="friend-info-modes">
        {MODES.map((mode) => {
          const entry = info.modes[mode]
          return <div key={mode} className={`friend-info-mode${entry ? '' : ' is-unknown'}`}>
            <span className="friend-info-mode-name">{modeLabel(mode)}</span>
            {entry ? <>
              <span className="friend-info-level"><small>{uiText('Уровень')}</small><strong>{entry.level}</strong></span>
              <PrestigeBadge level={entry.prestige} />
            </> : <span className="friend-info-none">{uiText('нет данных')}</span>}
          </div>
        })}
      </div>}
      {shown && !known.length && <p className="muted friend-info-hint">{uiText('Друг ещё не синхронизировал игровой аккаунт в Raid OS, или профиль игры не опубликован.')}</p>}
    </section>
  </div>, document.body)
}

/** Each prestige its own badge: the number on a shield, 1 bronze, 2 silver, 3 gold, 4 ice, 5 and up red. */
export function PrestigeBadge({ level }: { level: number }) {
  if (level <= 0) return <span className="prestige-badge is-none">{uiText('Без престижа')}</span>
  const label = `${uiText('Престиж')} ${level}`
  return <span className={`prestige-badge tier-${Math.min(level, 5)}`} title={label} aria-label={label} role="img">
    <svg viewBox="0 0 24 26" aria-hidden="true"><path d="M12 1.5 21 5v6.4c0 5.7-3.8 10-9 12.6-5.2-2.6-9-6.9-9-12.6V5z" /></svg>
    <b aria-hidden="true">{level}</b>
  </span>
}
