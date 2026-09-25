import { useState } from 'react'
import { AlertTriangle, Check, LoaderCircle, ShieldCheck, UserRound } from 'lucide-react'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { desktopPlayerProfileGateway } from '../profile/playerProfileGateway'
import { useAppState } from '../state/AppState'

export function ModeRegistrationDialog() {
  const state = useAppState()
  const [nickname, setNickname] = useState('')
  const [candidate, setCandidate] = useState<PlayerProfileCandidate | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const label = state.raidMode === 'pvp' ? 'PvP' : state.raidMode === 'pve' ? 'PvE' : 'сезонного режима'

  const findProfile = async () => {
    setLoading(true)
    setError('')
    setCandidate(null)
    try {
      setCandidate(await desktopPlayerProfileGateway().resolveByNickname(state.raidMode, nickname))
    } catch (findError) {
      setError(findError instanceof Error ? findError.message : 'Профиль не найден')
    } finally {
      setLoading(false)
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
  }

  return <div className="registration-overlay" role="dialog" aria-modal="true" aria-label={`Регистрация ${label}`}>
    <section className="panel registration-dialog">
      <div className="registration-icon"><UserRound size={28} /></div>
      <div className="eyebrow">Первый вход · {label}</div>
      <h2>Привяжите игровой профиль</h2>
      <p className="muted">Введите ник именно из режима {label}. Программа возьмёт Tarkov ID из последних журналов и сверит профиль с Tarkov.dev.</p>
      <label className="field-label">Ник Escape from Tarkov<input autoFocus className="input" value={nickname} onChange={(event) => { setNickname(event.target.value); setCandidate(null) }} onKeyDown={(event) => event.key === 'Enter' && nickname.trim() && void findProfile()} placeholder="Например: shaurma" /></label>
      {error && <div className="import-warning"><AlertTriangle size={17} /><span>{error}</span></div>}
      {candidate && <button className="profile-candidate" onClick={confirm}>
        <span className="profile-avatar small"><UserRound size={20} /></span>
        <span><strong>{candidate.nickname}</strong><small>{candidate.mode.toUpperCase()} · уровень {candidate.level} · {candidate.faction.toUpperCase()}</small></span>
        <span className="tag green"><Check size={12} /> Выбрать</span>
      </button>}
      <div className="import-note"><ShieldCheck size={14} /> Ник закрепляется отдельно за этим режимом. Изменить его можно позже в профиле.</div>
      {!candidate && <button className="button primary" disabled={loading || nickname.trim().length < 3} onClick={() => void findProfile()}>{loading ? <LoaderCircle className="spin" size={16} /> : <UserRound size={16} />} Найти профиль</button>}
    </section>
  </div>
}
