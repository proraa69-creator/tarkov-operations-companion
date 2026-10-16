import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { EyeOff, LoaderCircle, UserRound, X } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { fetchFriendInfo, type FriendInfo, type FriendModeInfo } from './socialClient'
import { ErrorLine } from './squadUi'
import { modeLabel } from './squadLabels'

const MODES: RaidMode[] = ['pvp', 'pve', 'seasonal']

/**
 * «Информация о друге» (owner, 12.10.2026: «уровни во всех режимах, значок пристижа, пристижи должны отличаться 1 2 3 4»):
 * level and prestige in every mode, as the friend's own desktop app read them from the game (squad/useShareLevels.ts),
 * else from the public game profile the server looks up (the game account id never reaches this app). A prestige the
 * friend's app does not know shows no badge; under each level, a dim date of when it was true. No note under the modes
 * (owner, 12.10.2026: «убери нижнюю надпись»). Opened by the square button on the friend's row.
 */
export function FriendInfoDialog({ friendId, name, color, onClose }: { friendId: string; name: string; color?: string; onClose: () => void }) {
  const { locale } = useLocale()
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
              <span className="friend-info-level">
                <small>{uiText('Уровень')}</small><strong>{entry.level}</strong>
                <UpdatedOn entry={entry} locale={locale} />
              </span>
              {entry.prestige !== null && <PrestigeBadge level={entry.prestige} />}
            </> : <span className="friend-info-none">{uiText('нет данных')}</span>}
          </div>
        })}
      </div>}
    </section>
  </div>, document.body)
}

/** «обновлено 13.10.2026» (13/10/2026 in English): the day the level was true, in the reader's time zone. */
function updatedDate(iso: string, locale: AppLocale) {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** The dim date under a level; its tooltip says where the level came from. */
function UpdatedOn({ entry, locale }: { entry: FriendModeInfo; locale: AppLocale }) {
  const day = entry.updatedAt ? updatedDate(entry.updatedAt, locale) : ''
  if (!day) return null
  const source = entry.source === 'app' ? uiText('Из приложения друга') : entry.source === 'tarkov-dev' ? uiText('Из публичного профиля Tarkov.dev') : undefined
  return <small className="friend-info-updated" title={source}>{uiText('обновлено')} {day}</small>
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
