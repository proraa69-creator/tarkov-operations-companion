import { useEffect, useState, type FormEvent } from 'react'
import { Check, ExternalLink, LoaderCircle } from 'lucide-react'
import { uiLabel } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { bindTypedNickname, retryNicknameLookups, tarkovDevProfileUrl, useMissingNicknameAccounts } from './logNickname'
import '../styles/gameLogs.css'

/** After «Открыть мой профиль на tarkov.dev»: Tarkov.dev is asked again every minute for this long, and on return to the app. */
const WATCH_MS = 15 * 60_000

/**
 * The logs showed the game account, but Tarkov.dev gives no profile for it — and the nickname came only from there
 * (owner, 13.10.2026: two players' nicknames stayed «not found» with their logs read). Tarkov.dev publishes a profile
 * once it is opened on tarkov.dev in a browser (its live lookup needs the browser's anti-bot check): one link, then the
 * app looks again by itself. Or the player types the nickname (owner: «вернуть ручной ввод ника») — bound to the game
 * account of these logs, replaced by Tarkov.dev's real name once Tarkov.dev answers.
 */
export function NicknameMissingHelp() {
  const missing = useMissingNicknameAccounts()
  const state = useAppState()
  const [watching, setWatching] = useState(false)
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!watching) return
    const retry = () => void retryNicknameLookups()
    const timer = window.setInterval(retry, 60_000)
    const stop = window.setTimeout(() => setWatching(false), WATCH_MS)
    window.addEventListener('focus', retry)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(stop)
      window.removeEventListener('focus', retry)
    }
  }, [watching])
  const target = missing.find((entry) => entry.mode === state.raidMode) ?? missing[0]
  if (!target) return null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await bindTypedNickname(typed, () => state)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="nickname-missing">
      <p>{uiLabel('Аккаунт игры в логах найден, но tarkov.dev ещё не опубликовал его профиль, а ник приложение берёт оттуда. Откройте свой профиль на tarkov.dev один раз — ник появится сам через минуту-другую.')}</p>
      <a className="button small" href={tarkovDevProfileUrl(target.mode, target.accountId)} target="_blank" rel="noreferrer" onClick={() => setWatching(true)}>
        <ExternalLink size={13} aria-hidden="true" />{uiLabel('Открыть мой профиль на tarkov.dev')}
      </a>
      {watching && <small className="nickname-missing-wait"><LoaderCircle size={12} className="spin" aria-hidden="true" />{uiLabel('Проверяем ник каждую минуту…')}</small>}
      <form className="nickname-missing-form" onSubmit={(event) => void save(event)}>
        <label>
          <span>{uiLabel('Или введите ник вручную')}</span>
          <input className="input" value={typed} maxLength={15} spellCheck={false} autoComplete="off" placeholder="Nickname" onChange={(event) => setTyped(event.target.value)} />
        </label>
        <button type="submit" className="button small primary" disabled={saving || !typed.trim()}>
          {saving ? <LoaderCircle size={13} className="spin" aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{uiLabel('Сохранить ник')}
        </button>
      </form>
      {error && <small className="nickname-missing-error" role="alert">{uiLabel(error)}</small>}
      <small className="nickname-missing-note">{uiLabel('Ник сохранится за аккаунтом игры из логов этого компьютера. Когда tarkov.dev начнёт отвечать, приложение само сверит его с настоящим.')}</small>
    </div>
  )
}
