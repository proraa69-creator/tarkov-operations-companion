import { ClipboardCopy, KeyRound, LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { api } from '../../api'
import { Notice } from '../Notice'
import { failure, type Failure } from './adminData'

/**
 * A bookmark that shows the Boosty session of the page it is opened on (boosty.to): the `auth` and `_clientId` values
 * of its localStorage as one JSON line to copy. It sends nothing anywhere. Safari on iPhone has no developer tools, so
 * this is how the owner takes the session from the phone (owner, 17.10.2026).
 */
export const BOOSTY_BOOKMARKLET = "javascript:(()=>{const a=localStorage.getItem('auth'),c=localStorage.getItem('_clientId');if(!a||!c){alert('Откройте закладку на boosty.to после входа в аккаунт');return}prompt('Скопируйте всё и вставьте в админку Raid OS',JSON.stringify({auth:a,clientId:c}))})()"

/**
 * «Токен Boosty» (owner, 17.10.2026): the owner pastes a new Boosty session here instead of editing BOOSTY_AUTH on the
 * server (PUT /v1/accounts/me/admin/boosty/session). The server keeps it next to its database and never shows it again.
 */
export function AdminBoostySession({ token, dead, onSaved }: { token: string | null; dead: boolean; onSaved: () => Promise<unknown> | void }) {
  const [session, setSession] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!token || !session.trim()) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api.adminBoostySession(token, session.trim())
      setSession('')
      setSaved(true)
      await onSaved()
    } catch (reason) { setError(failure(reason)) } finally { setBusy(false) }
  }

  async function copyBookmarklet() {
    try { await navigator.clipboard.writeText(BOOSTY_BOOKMARKLET); setCopied(true) } catch { setCopied(false) }
  }

  return (
    <details className="admin-boosty-session" open={dead}>
      <summary><KeyRound aria-hidden="true" size={16} /> Токен Boosty{dead ? ' — нужен новый' : ''}</summary>
      <form className="admin-stack" onSubmit={(event) => void save(event)}>
        <label className="field">
          <span>Данные Boosty (то, что показала закладка)</span>
          <textarea rows={3} value={session} onChange={(event) => setSession(event.target.value)} placeholder='{"auth":"…","clientId":"…"}' autoComplete="off" spellCheck={false} />
        </label>
        <div className="admin-chips">
          <button type="submit" className="button small primary" disabled={busy || !session.trim()}>
            {busy ? <LoaderCircle className="spinner" aria-hidden="true" /> : <KeyRound aria-hidden="true" />}Сохранить и проверить
          </button>
        </div>
        {error && <Notice tone={error.offline ? 'offline' : 'error'} title="Токен не сохранён">{error.message}</Notice>}
        {saved && <Notice tone="success" title="Токен сохранён">Сервер запустил проверку подписчиков. Через минуту нажмите «Обновить», чтобы увидеть результат.</Notice>}
        <div className="admin-boosty-howto">
          <strong>Как взять токен с iPhone (Safari)</strong>
          <ol>
            <li>Скопируйте код закладки: <button type="button" className="button small ghost" onClick={() => void copyBookmarklet()}><ClipboardCopy aria-hidden="true" />{copied ? 'Скопировано' : 'Скопировать код'}</button></li>
            <li>В Safari добавьте в закладки любую страницу («Поделиться» → «Добавить закладку»), назовите её «Boosty → Raid OS». Затем откройте «Закладки» → «Изменить», выберите эту закладку и вместо адреса вставьте скопированный код.</li>
            <li>Откройте <strong>частную</strong> вкладку, зайдите на boosty.to и войдите в аккаунт.</li>
            <li>На странице boosty.to наберите в адресной строке «Boosty → Raid OS» и выберите закладку (или откройте её из «Закладок»).</li>
            <li>Появится окно с текстом: выделите всё, скопируйте и вставьте в поле выше.</li>
            <li>Закройте частную вкладку <strong>без «Выйти»</strong> и больше не открывайте в ней Boosty — это отдельная сессия только для сервера, поэтому она не будет сбиваться.</li>
          </ol>
          <p className="muted">На компьютере так же работает эта закладка в любом браузере. Код закладки ничего никуда не отправляет — он только показывает данные этой страницы.</p>
        </div>
      </form>
    </details>
  )
}
