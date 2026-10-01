import { useEffect, useState } from 'react'
import { Bug, FlaskConical } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { ErrorReportSettings } from '../electron'

/**
 * «Отчёты об ошибках (GitHub)» under «Сервер и сайт на этом компьютере»: the server laptop's errors (API exceptions and
 * 5xx, «Страж сервера» incidents, watchdog give-ups, self-update rollbacks) become issues in the owner's repository,
 * sanitized and deduplicated (electron/errorReport.ts, electron/errorReporter.ts). The token is encrypted with
 * safeStorage in the main process and write-only here. Not on the website on purpose.
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function OwnerErrorReportsPanel() {
  const api = window.tarkovDesktop?.owner
  const [saved, setSaved] = useState<ErrorReportSettings | null>(null)
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = (value: ErrorReportSettings) => { setSaved(value); setRepo(value.repo); setToken('') }
  useEffect(() => {
    void api?.errorReports?.().then(apply).catch(() => {})
  }, [api])
  if (!api?.errorReports || !api.setErrorReports || !saved) return null

  const status = !saved.enabled
    ? uiText('Выключено')
    : `${uiText('Включено')}: ${saved.repo}${saved.pending ? ` · ${uiText('ждут отправки')}: ${saved.pending}` : ''}`
  const run = (task: () => Promise<ErrorReportSettings>, done?: string) => {
    setBusy(true); setMessage(null)
    void task()
      .then((value) => { apply(value); if (done) setMessage({ ok: true, text: done }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  const save = (enabled = saved.enabled) => run(() => api.setErrorReports!({ enabled, repo: repo.trim(), ...(token.trim() ? { token: token.trim() } : {}) }), 'Сохранено')

  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><Bug size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Отчёты об ошибках (GitHub)')}</strong>
          <small>{status}</small>
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" role="switch" aria-checked={saved.enabled} aria-label={uiText('Отчёты об ошибках (GitHub)')} className={`toggle ${saved.enabled ? 'on' : ''}`} disabled={busy || (!saved.hasToken && !token.trim())} onClick={() => save(!saved.enabled)}><span /></button>
          <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
        </span>
      </div>
      {saved.lastResult && <small style={{ color: saved.lastResult.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(saved.lastResult.text)}</small>}
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Ошибки сервера (исключения, ответы 5xx, сбои «Стража», неудачные перезапуски, откаты обновлений) создают задачи на GitHub с меткой auto-report — их можно передать Claude для исправления. IP-адреса, e-mail, токены, ключи, параметры запросов и пути пользователя удаляются. Одна ошибка — одна задача: повторы добавляют комментарий не чаще раза в час, новых задач не больше 5 в сутки. Без интернета отчёты ждут в очереди.')}</small>
          <small>{uiText('Токен: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token → Repository access: Only select repositories (только этот репозиторий) → Permissions: Issues — Read and write, больше ничего. Токен хранится на этом компьютере в зашифрованном виде и больше не показывается.')}</small>
          <label><span>{uiText('Репозиторий')}</span><input className="input" value={repo} maxLength={200} onChange={(event) => setRepo(event.target.value)} placeholder="proraa69-creator/tarkov-operations-companion" autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Токен GitHub')}</span><input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={uiText(saved.hasToken ? 'Сохранён. Оставьте пустым, чтобы не менять' : 'github_pat_… (Issues: Read and write)')} autoComplete="off" spellCheck={false} /></label>
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {saved.hasToken && <button type="button" className="button ghost" disabled={busy} onClick={() => run(() => api.setErrorReports!({ enabled: false, clearToken: true }), 'Токен удалён')}>{uiText('Удалить токен')}</button>}
            {saved.hasToken && api.testErrorReports && <button type="button" className="button" disabled={busy} onClick={() => run(() => api.testErrorReports!())}><FlaskConical size={14} />{uiText('Проверить доступ')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
        </form>
      )}
    </div>
  )
}
