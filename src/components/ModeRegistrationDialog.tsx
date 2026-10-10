import { uiText } from '../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, ShieldCheck, UserRound, X } from 'lucide-react'
import { useNicknameBinder, type NicknameBinding } from '../account/useNicknameBinder'
import { BoundNickname } from '../account/BoundNickname'

/**
 * «Привязать ник» / «Сменить ник»: one Escape from Tarkov nickname for PvP, PvE and «Сезон» (owner, 10.10.2026). Opened
 * from the profile, or by itself on a switch to an unbound mode while no nickname is known (account/AccountController.tsx).
 */
export function ModeRegistrationDialog({ onClose }: { onClose: () => void }) {
  const bind = useNicknameBinder()
  const inputRef = useRef<HTMLInputElement>(null)
  const [nickname, setNickname] = useState('')
  const [bound, setBound] = useState<NicknameBinding | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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
      setBound(await bind(nickname))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Профиль не найден')
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    } finally {
      setLoading(false)
    }
  }

  return <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={uiText('Привязать ник')} onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose()
  }}>
    <section className="panel registration-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <button className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
      <div className="registration-icon"><UserRound size={28} /></div>
      <div className="eyebrow">{uiText('PvP · PvE · Сезон')}</div>
      <h2>{uiText('Привязать ник')}</h2>
      <p className="muted">{uiText('Введите ник персонажа в Escape from Tarkov — он один для PvP, PvE и «Сезона». Программа найдёт профиль в каждом режиме, прогресс у режимов свой.')}</p>
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
      {bound && <BoundNickname binding={bound} />}
      <div className="import-note"><ShieldCheck size={14} />{uiText('Ник сохраняется в вашем аккаунте и один для всех режимов. Изменить его можно позже в профиле.')}</div>
      {!bound && <button type="button" className="button primary" disabled={loading || nickname.trim().length < 3} onClick={() => void submit()}>
        {loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />}{uiText(loading ? 'Ищем профиль…' : 'Привязать ник')}
      </button>}
    </section>
  </div>
}

export function openModeRegistrationDialog() {
  window.dispatchEvent(new Event('tarkov-open-registration'))
}
