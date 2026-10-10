import { Link2Off, LoaderCircle, LogIn, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, errorMessage, FRIEND_CODE_PATTERN, squadApi, SQUAD_CODE_PATTERN } from '../api'
import { useAuth } from '../auth'
import { Notice } from '../components/Notice'

/** Invite links are personal: keep them out of search results. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex, nofollow'
    document.head.appendChild(meta)
    return () => meta.remove()
  }, [])
}

/**
 * /squad/<code> (join a squad) and /friend/<code> (send a friend request). Nothing happens without a click: the
 * signed-in person confirms; somebody signed out signs in and opens the link again (the cabinet has no squad block).
 */
export function SquadLinkPage({ kind }: { kind: 'squad' | 'friend' }) {
  useNoIndex()
  const { code = '' } = useParams()
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [done, setDone] = useState('')
  const valid = (kind === 'squad' ? SQUAD_CODE_PATTERN : FRIEND_CODE_PATTERN).test(code)
  const signedIn = auth.status === 'ready' && auth.account !== null && auth.token

  async function accept() {
    if (!auth.token) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'squad') {
        await squadApi.join(auth.token, code)
        setDone('Вы в отряде. Общие задания и кому что нужно — в приложении, раздел «Отряд».')
      } else {
        const answer = await squadApi.friendRequest(auth.token, code)
        setDone(answer.status === 'friends' ? 'Вы теперь друзья. Список друзей — в приложении, раздел «Отряд».' : 'Запрос отправлен. Когда друг примет его, вы увидите друг друга в приложении, раздел «Отряд» → «Друзья».')
      }
    } catch (reason) {
      setError(reason)
    } finally {
      setBusy(false)
    }
  }

  const title = kind === 'squad' ? 'Приглашение в отряд' : 'Приглашение в друзья'
  if (!valid) {
    return (
      <div className="container page page-in">
        <div className="panel center-state" style={{ padding: 24 }}>
          <Link2Off aria-hidden="true" />
          <div style={{ maxWidth: 460 }}><h1 style={{ margin: '0 0 8px', fontSize: 24, color: 'var(--text)' }}>Ссылка недействительна</h1><p style={{ margin: 0 }}>Проверьте ссылку или попросите новую.</p></div>
          <Link to="/" className="button ghost">На главную</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container auth-wrap page-in">
      <div className="panel auth-card invite-card">
        <div className="eyebrow">{title}</div>
        <h1>{kind === 'squad' ? 'Вас зовут в отряд' : 'Вас добавляют в друзья'}</h1>
        <div className="invite-code"><span className="field-label">{kind === 'squad' ? 'Код отряда' : 'Код друга'}</span><code>{code.toUpperCase()}</code></div>
        <ul className="invite-points">
          {kind === 'squad'
            ? <><li>В отряде до 5 человек. Участники видят друг друга только по нику в игре для выбранного режима — e-mail никому не показывается.</li><li>Общие задания по картам и кому что нужно — в приложении Raid OS. Покинуть отряд можно в любой момент.</li></>
            : <><li>Друг увидит ваш ник в игре, активные задания и нужные предметы — e-mail не показывается.</li><li>Скрыть свой прогресс от конкретного друга можно в приложении в любой момент.</li></>}
        </ul>
        {error !== null && <Notice tone={error instanceof ApiError && error.network ? 'offline' : 'error'}>{errorMessage(error)}</Notice>}
        {done && <Notice tone="success">{done}</Notice>}
        {auth.status === 'loading' ? (
          <div className="muted" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><LoaderCircle className="spinner" size={16} aria-hidden="true" />Проверяем вход…</div>
        ) : signedIn ? (
          !done && <button type="button" className="button primary large block" disabled={busy} onClick={() => void accept()}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : kind === 'squad' ? <Users aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
            {kind === 'squad' ? 'Вступить в отряд' : 'Отправить запрос в друзья'}
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Войдите или зарегистрируйтесь, затем откройте ссылку ещё раз.</p>
            <Link to="/login" className="button primary block"><LogIn aria-hidden="true" />Войти</Link>
            <Link to="/register" className="button ghost block"><UserPlus aria-hidden="true" />Регистрация</Link>
          </div>
        )}
      </div>
    </div>
  )
}
