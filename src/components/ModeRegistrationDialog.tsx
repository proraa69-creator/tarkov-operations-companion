import { uiText } from '../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, ShieldCheck, UserRound, X } from 'lucide-react'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { useAppState } from '../state/AppState'
import { modeTitle } from '../account/nicknameBinding'
import { useNicknameBinder } from '../account/useNicknameBinder'

/**
 * «Привязать ник» for the mode selected in the top bar (also opened when the app switches to a mode without a bound
 * nickname: by the mode buttons or by the game mode read from the EFT logs, see account/AccountController.tsx).
 */
export function ModeRegistrationDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState()
  const bind = useNicknameBinder()
  const inputRef = useRef<HTMLInputElement>(null)
  const [nickname, setNickname] = useState('')
  const [bound, setBound] = useState<PlayerProfileCandidate | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const mode = state.raidMode
  const label = modeTitle(mode)

  useEffect(() => {
    const focus = () => {
      const node = inputRef.current
      if (!node) return
      node.focus({ preventScroll: true })
      node.select()
    }
    // After window.confirm / profile delete Electron can leave focus dead until remount.
    const timers = [0, 50, 160, 320].map((delay) => window.setTimeout(focus, delay))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [])

  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    if (!bound) return
    const timer = window.setTimeout(() => closeRef.current(), 1400)
    return () => window.clearTimeout(timer)
  }, [bound])

  const submit = async () => {
    if (loading || bound) return
    setLoading(true)
    setError('')
    try {
      setBound(await bind(mode, nickname))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Профиль не найден')
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    } finally {
      setLoading(false)
    }
  }

  return <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={uiText(`Привязать ник · ${label}`)} onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="panel registration-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <button className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className="registration-icon"><UserRound size={28} /></div>
      <div className="eyebrow">{uiText('Режим · ')}{uiText(label)}</div>
      <h2>{uiText('Привязать ник')}</h2>
      <p className="muted">{uiText(`Для режима ${label} ник ещё не привязан. Введите ник, который у вас в этом режиме игры: программа найдёт профиль на Tarkov.dev и закрепит его за режимом.`)}</p>
      <label className="field-label">{uiText('Ник Escape from Tarkov')}<input
          ref={inputRef}
          className="input"
          value={nickname}
          autoComplete="off"
          spellCheck={false}
          maxLength={15}
          disabled={Boolean(bound)}
          onChange={(event) => { setNickname(event.target.value); setError('') }}
          onKeyDown={(event) => { if (event.key === 'Enter' && nickname.trim()) void submit() }}
          placeholder={uiText('Например: shaurma')}
        />
      </label>
      {error && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>}
      {bound && <div className="profile-candidate account-bound" role="status">
        <span className="profile-avatar small"><UserRound size={20} /></span>
        <span><strong>{bound.nickname}</strong><small>{bound.pending ? <>{bound.mode.toUpperCase()}{uiText(' · уровень появится, когда Tarkov.dev обновит профиль')}</> : <>{bound.mode.toUpperCase()}{uiText(' · уровень ')}{bound.level} · {bound.faction.toUpperCase()}</>}</small></span>
        <span className="tag green"><Check size={12} />{uiText('Привязан')}</span>
      </div>}
      <div className="import-note"><ShieldCheck size={14} />{uiText('Ник закрепляется отдельно за этим режимом и сохраняется в вашем аккаунте. Изменить его можно позже в профиле.')}</div>
      {!bound && <button type="button" className="button primary" disabled={loading || nickname.trim().length < 3} onClick={() => void submit()}>
        {loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />}{uiText(loading ? 'Ищем профиль…' : 'Привязать ник')}
      </button>}
    </section>
  </div>
}

export function openModeRegistrationDialog() {
  window.dispatchEvent(new Event('tarkov-open-registration'))
}
