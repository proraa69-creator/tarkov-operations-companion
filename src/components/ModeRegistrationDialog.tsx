import { uiText } from '../i18n/renderText'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, ShieldCheck, UserRound, X } from 'lucide-react'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { desktopPlayerProfileGateway } from '../profile/playerProfileGateway'
import { useAppState } from '../state/AppState'

export function ModeRegistrationDialog({ onClose }: { onClose: () => void }) {
  const state = useAppState()
  const inputRef = useRef<HTMLInputElement>(null)
  const [nickname, setNickname] = useState('')
  const [candidate, setCandidate] = useState<PlayerProfileCandidate | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const label = state.raidMode === 'pvp' ? 'PvP' : state.raidMode === 'pve' ? 'PvE' : 'сезонного режима'

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

  const findProfile = async () => {
    if (loading) return
    const cleaned = nickname.trim().replace(/[\u200B-\u200D\uFEFF]/g, '')
    if (cleaned.length < 3) {
      setError('Введите ник Escape from Tarkov (минимум 3 символа)')
      return
    }
    setNickname(cleaned)
    setLoading(true)
    setError('')
    setCandidate(null)
    try {
      setCandidate(await desktopPlayerProfileGateway().resolveByNickname(state.raidMode, cleaned))
    } catch (findError) {
      const raw = findError instanceof Error ? findError.message : 'Профиль не найден'
      setError(raw
        .replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
        .replace(/^TimeoutError:\s*/i, '')
        .replace(/^Error:\s*/i, '')
      )
    } finally {
      setLoading(false)
      window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  const confirm = () => {
    if (!candidate) return
    const verifiedAt = new Date().toISOString()
    state.registerModeProfile(state.raidMode, {
      accountId: candidate.accountId,
      enteredNickname: nickname.trim(),
      nickname: candidate.nickname,
      verifiedAt,
    })
    state.updatePlayerSnapshot(state.raidMode, candidate.snapshot)
    onClose()
  }

  const close = () => {
    onClose()
  }

  return <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={uiText(`Регистрация ${label}`)} onMouseDown={(event) => {
    if (event.target === event.currentTarget) close()
  }}>
    <section className="panel registration-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <button className="registration-close" onClick={close} aria-label={uiText("Закрыть")}><X size={18} /></button>
      <div className="registration-icon"><UserRound size={28} /></div>
      <div className="eyebrow">{uiText("Привязка профиля · ")}{uiText(label)}</div>
      <h2>{uiText("Привяжите игровой профиль")}</h2>
      <p className="muted">{uiText("Введите ник именно из режима ")}{uiText(label)}{uiText(". Программа ищет профиль в индексе Tarkov.dev для этого режима и сверяет с журналами, если они есть.")}</p>
      <label className="field-label">{uiText("Ник Escape from Tarkov ")}<input
          ref={inputRef}
          className="input"
          value={nickname}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setNickname(event.target.value); setCandidate(null); setError('') }}
          onKeyDown={(event) => event.key === 'Enter' && nickname.trim() && void findProfile()}
          placeholder={uiText("Например: shaurma")}
        />
      </label>
      {uiText(error && <div className="import-warning"><AlertTriangle size={17} /><span>{uiText(error)}</span></div>)}
      {uiText(candidate && <button type="button" className="profile-candidate" onClick={confirm}>
        <span className="profile-avatar small"><UserRound size={20} /></span>
        <span><strong>{uiText(candidate.nickname)}</strong><small>{uiText(candidate.mode.toUpperCase())}{uiText(" · уровень ")}{uiText(candidate.level)} · {uiText(candidate.faction.toUpperCase())}</small></span>
        <span className="tag green"><Check size={12} />{uiText(" Подтвердить")}</span>
      </button>)}
      <div className="import-note"><ShieldCheck size={14} />{uiText(" Ник закрепляется отдельно за этим режимом. Изменить его можно позже в профиле.")}</div>
      {uiText(!candidate && <button type="button" className="button primary" disabled={loading || nickname.trim().length < 3} onClick={() => void findProfile()}>{uiText(loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />)}{uiText(" Найти профиль")}</button>)}
    </section>
  </div>
}

export function openModeRegistrationDialog() {
  window.dispatchEvent(new Event('tarkov-open-registration'))
}
