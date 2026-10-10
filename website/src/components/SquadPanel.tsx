import { Crown, DoorOpen, EyeOff, LoaderCircle, LogIn, RefreshCw, ShieldAlert, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { errorMessage, squadApi, SQUAD_CODE_PATTERN, type AccountMode, type SquadMine, type SquadOverview } from '../api'
import { useAuth } from '../auth'
import { CopyButton } from './CopyButton'
import { Notice } from './Notice'
import { readPendingSquadCode, savePendingSquadCode } from '../storage'

const MODES: Array<{ id: AccountMode; label: string }> = [{ id: 'pvp', label: 'PvP' }, { id: 'pve', label: 'PvE' }, { id: 'seasonal', label: 'Сезон' }]

/**
 * Cabinet «Отряд»: the squad for the chosen mode (members by that mode's nickname only), invitations, joining by code
 * or by an opened /squad/<code> link, inviting, leaving and disbanding. Shared tasks per map are in the app.
 */
async function fetchSquad(token: string, mode: AccountMode) {
  const mine = await squadApi.mine(token, mode)
  const overview = mine.squad && mine.access ? await squadApi.overview(token, mine.squad.id, mode).catch(() => null) : null
  return { mine, overview }
}

export function SquadPanel() {
  const auth = useAuth()
  const token = auth.token
  const [mode, setMode] = useState<AccountMode>('pvp')
  const [mine, setMine] = useState<SquadMine | null>(null)
  const [overview, setOverview] = useState<SquadOverview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState(() => readPendingSquadCode())
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null)
  const [confirm, setConfirm] = useState<'' | 'leave' | 'disband'>('')

  const load = useCallback(() => {
    if (!token) return Promise.resolve()
    return fetchSquad(token, mode).then(
      (next) => { setMine(next.mine); setOverview(next.overview); setError('') },
      (reason: unknown) => setError(errorMessage(reason)),
    )
  }, [token, mode])
  useEffect(() => { void load() }, [load])

  async function act(work: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await work()
      await load()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  function join(event: FormEvent) {
    event.preventDefault()
    if (!token || !SQUAD_CODE_PATTERN.test(code.trim())) return
    void act(async () => { await squadApi.join(token, code.trim()); savePendingSquadCode(null); setCode('') })
  }

  const squad = overview?.squad ?? mine?.squad ?? null
  const link = invite ? `${window.location.origin}/squad/${invite.code}` : ''

  return (
    <section className="panel squad-panel" id="squad" aria-labelledby="squad-title">
      <div className="panel-header">
        <div className="panel-title" id="squad-title"><Users aria-hidden="true" />Отряд</div>
        <div className="squad-modes" role="tablist" aria-label="Режим">
          {MODES.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={mode === entry.id} className={`button small ${mode === entry.id ? 'primary' : 'ghost'}`} onClick={() => setMode(entry.id)}>{entry.label}</button>)}
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        {error && <Notice tone="error">{error}</Notice>}
        {!mine ? (
          <div className="muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{error ? <button type="button" className="button small" onClick={() => void load()}><RefreshCw aria-hidden="true" />Повторить</button> : <><LoaderCircle className="spinner" size={16} aria-hidden="true" />Загружаем отряд…</>}</div>
        ) : (
          <>
            {!mine.access && (
              <Notice tone="warn" title="Отряд — функция подписки">
                <ShieldAlert size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />Создать отряд, вступить и видеть общие задания можно с активной подпиской. Покинуть отряд можно всегда.
              </Notice>
            )}
            {!squad && mine.invitations.map((invitation) => (
              <div key={invitation.invitationId} className="squad-member">
                <Users size={16} aria-hidden="true" />
                <span className="squad-member-main"><strong>{invitation.squadName}</strong><small className="muted">Приглашение · командир {invitation.from ?? 'без ника'} · {invitation.members} / 5</small></span>
                <button type="button" className="button small primary" disabled={busy || !mine.access} onClick={() => token && void act(() => squadApi.answerInvitation(token, invitation.invitationId, true))}>Вступить</button>
                <button type="button" className="button small ghost" disabled={busy} onClick={() => token && void act(() => squadApi.answerInvitation(token, invitation.invitationId, false))}>Отклонить</button>
              </div>
            ))}
            {squad ? (
              <>
                <div className="squad-summary">
                  <strong>{squad.name || 'Отряд'}</strong>
                  <span className="tag">{squad.members.length} / {squad.maxMembers}</span>
                  {squad.isOwner && <span className="tag brass"><Crown size={11} aria-hidden="true" />Вы командир</span>}
                  {overview && <span className="tag green">Общих заданий: {overview.sharedQuests.length}</span>}
                </div>
                <ul className="squad-members">
                  {squad.members.map((member, index) => (
                    <li key={member.memberId} className="squad-member">
                      <span className={`squad-avatar hue-${index % 5}`} aria-hidden="true">{(member.nickname ?? '?').slice(0, 1).toUpperCase()}</span>
                      <span className="squad-member-main">
                        <strong>{member.nickname ?? `Боец ${index + 1}`}{member.isYou && <span className="muted"> · вы</span>}</strong>
                        <small className="muted">
                          {member.isOwner && 'Командир · '}
                          {member.hidden ? <><EyeOff size={11} aria-hidden="true" /> скрыл прогресс</> : member.activeQuestIds ? `активных заданий: ${member.activeQuestIds.length}` : ''}
                          {!member.nickname && ' · ник ещё не найден'}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
                {invite && (
                  <div className="squad-invite">
                    <div className="copy-row"><code>{invite.code}</code><CopyButton value={invite.code} /></div>
                    <div className="copy-row"><code>{link}</code><CopyButton value={link} /></div>
                    <small className="muted">Действует 24 часа; новый код отменяет прежний.</small>
                  </div>
                )}
                {confirm ? (
                  <div className="squad-actions">
                    <span className="muted">{confirm === 'leave' ? 'Покинуть отряд?' : 'Распустить отряд для всех?'}</span>
                    <button type="button" className="button small danger" disabled={busy} onClick={() => { const action = confirm; setConfirm(''); if (token) void act(() => (action === 'leave' ? squadApi.leave(token, squad.id) : squadApi.disband(token, squad.id))) }}>{confirm === 'leave' ? 'Покинуть' : 'Распустить'}</button>
                    <button type="button" className="button small ghost" onClick={() => setConfirm('')}>Отмена</button>
                  </div>
                ) : (
                  <div className="squad-actions">
                    {squad.isOwner && <button type="button" className="button small" disabled={busy || !mine.access} onClick={() => token && void act(async () => setInvite(await squadApi.invite(token, squad.id)))}>Пригласить по ссылке</button>}
                    <button type="button" className="button small ghost" disabled={busy} onClick={() => setConfirm('leave')}><DoorOpen size={14} aria-hidden="true" />Покинуть</button>
                    {squad.isOwner && <button type="button" className="button small ghost" disabled={busy} onClick={() => setConfirm('disband')}><Trash2 size={14} aria-hidden="true" />Распустить</button>}
                  </div>
                )}
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>Общие задания по картам, кому что нужно и план рейда — в приложении Raid OS, раздел «Отряд».</p>
              </>
            ) : (
              <form className="form squad-join" onSubmit={join}>
                <label className="field">
                  <span className="field-label">Код приглашения</span>
                  <input className="input mono" value={code} onChange={(event) => setCode(event.target.value)} placeholder="XXXXX-XXXXX" autoCapitalize="characters" spellCheck={false} />
                </label>
                <button type="submit" className="button primary" disabled={busy || !mine.access || !SQUAD_CODE_PATTERN.test(code.trim())}>{busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <LogIn aria-hidden="true" />}Вступить в отряд</button>
                <span className="field-hint">Создать отряд можно в приложении или здесь: <button type="button" className="link-button" disabled={busy || !mine.access} onClick={() => token && void act(() => squadApi.create(token, ''))}>создать отряд</button>. <Link to="/download">Скачать приложение</Link></span>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  )
}
