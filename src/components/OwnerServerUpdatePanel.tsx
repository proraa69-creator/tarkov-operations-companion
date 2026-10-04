import { useEffect, useState } from 'react'
import { DownloadCloud, PackageCheck, RefreshCw, Undo2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { ServerBuildRef, ServerInstallWindow, ServerUpdateView } from '../electron'

/**
 * «Автообновление сервера» under «Сервер и сайт на этом компьютере» (the server laptop): the private releases repository
 * the laptop updates itself from, a read-only token (encrypted with safeStorage in the main process, write-only here),
 * on/off, the install mode and the status (electron/selfUpdate.ts). By default the mode is «вручную»: the laptop only
 * downloads and verifies, then waits for «Установить сейчас» (here or in the website's «Обновление» tab, which shows the
 * same status but cannot change these settings).
 */
const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const PHASE: Record<ServerUpdateView['updater']['phase'], string> = {
  off: 'выключено', idle: 'ждёт новую версию', checking: 'проверяю…', downloading: 'скачиваю…', verifying: 'проверяю подпись и контрольные суммы…',
  ready: 'скачано и проверено, ждёт окна установки', installing: 'устанавливаю…', error: 'ошибка',
}
const READY_TEXT = 'Скачано и проверено, ждёт установки'
const phaseText = (updater: ServerUpdateView['updater']) => (updater.phase === 'ready' && updater.waitingForInstall ? READY_TEXT : PHASE[updater.phase])
const windowOf = (value: string): ServerInstallWindow => (value === 'any' || value === 'night' ? value : 'manual')
const build = (value: ServerBuildRef) => `${value.version} (${value.build})`
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—')

export function OwnerServerUpdatePanel() {
  const api = window.tarkovDesktop?.owner
  const [view, setView] = useState<ServerUpdateView | null>(null)
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!api?.serverUpdate) return
    let first = true
    const load = () => void api.serverUpdate!().then((value) => { setView(value); if (first) { setRepo(value.repo); first = false } }).catch(() => {})
    load()
    const timer = window.setInterval(load, 3000)
    return () => window.clearInterval(timer)
  }, [api])
  if (!api?.serverUpdate || !api.setServerUpdate || !view) return null

  const run = (task: () => Promise<ServerUpdateView>, done?: string) => {
    setBusy(true); setMessage(null)
    void task()
      .then((value) => { setView(value); setToken(''); if (done) setMessage({ ok: true, text: done }) })
      .catch((reason: unknown) => setMessage({ ok: false, text: errorText(reason) }))
      .finally(() => setBusy(false))
  }
  const save = (patch: { enabled?: boolean; window?: ServerInstallWindow } = {}) => run(() => api.setServerUpdate!({ repo: repo.trim(), ...(token.trim() ? { token: token.trim() } : {}), ...patch }), 'Сохранено')
  const rollback = () => {
    if (!view.previous || !api.rollbackServerUpdate) return
    if (!window.confirm(`${uiText('Откатить сервер на предыдущую версию')} ${build(view.previous)}? ${uiText('Сервер перезапустится (около минуты).')}`)) return
    run(() => api.rollbackServerUpdate!())
  }
  const install = () => {
    if (!view.ready || !api.installServerUpdate) return
    if (!window.confirm(`${uiText('Установить версию сервера')} ${build(view.ready)}? ${uiText('Сервер перезапустится (около минуты); если новая версия не ответит за 2 минуты, вернётся текущая.')}`)) return
    run(() => api.installServerUpdate!(), 'Установка началась: сервер перезапускается')
  }
  const canInstall = Boolean(view.ready && api.installServerUpdate && view.enabled && !view.unsupported && !view.restart)
  const updater = view.updater
  const status = view.unsupported
    ? `${uiText('Не работает на этом компьютере')}: ${uiText(view.unsupported)}`
    : !view.enabled ? uiText('Выключено') : `${uiText('Включено')}: ${uiText(phaseText(updater))}`

  return (
    <div className="setting-row owner-panel">
      <div className="owner-panel-head">
        <span>
          <strong><DownloadCloud size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />{uiText('Автообновление сервера')}</strong>
          <small>{status} · {uiText('установлена версия')} {build(view.current)}</small>
        </span>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button type="button" role="switch" aria-checked={view.enabled} aria-label={uiText('Автообновление сервера')} className={`toggle ${view.enabled ? 'on' : ''}`} disabled={busy || (!view.hasToken && !token.trim())} onClick={() => save({ enabled: !view.enabled })}><span /></button>
          <button className="button ghost" onClick={() => setOpen(!open)}>{uiText(open ? 'Свернуть' : 'Настроить')}</button>
        </span>
      </div>
      {view.restart && <small>{uiText(view.restart.kind === 'update' ? 'Перезапуск после обновления' : 'Перезапуск после отката')}: {build(view.restart.from)} → {build(view.restart.to)} · {view.restart.phase}</small>}
      {updater.latest && updater.phase !== 'idle' && <small>{uiText('Новая версия на GitHub')}: {build(updater.latest)}{updater.waitingForWindow ? ` · ${uiText('установка ночью (03:00–06:00)')}` : ''}</small>}
      {canInstall && view.ready && (
        <span className="owner-actions">
          <small style={{ color: 'var(--green)' }}>{uiText(READY_TEXT)}: {build(view.ready)}</small>
          <button type="button" className="button primary" disabled={busy} onClick={install}><PackageCheck size={14} />{uiText('Установить сейчас')}</button>
        </span>
      )}
      {!open && message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
      {updater.files.length > 0 && updater.phase === 'downloading' && (
        <small>{updater.files.map((file) => `${file.name} ${Math.floor((file.done / file.size) * 100)}%`).join(' · ')}</small>
      )}
      {updater.error && <small style={{ color: 'var(--danger)' }}>{uiText(updater.error)}</small>}
      {open && (
        <form className="owner-form" onSubmit={(event) => { event.preventDefault(); save() }}>
          <small>{uiText('Ноутбук сам проверяет закрытый репозиторий релизов каждую минуту, скачивает новую сборку, проверяет подпись (ключ встроен в приложение), размеры и SHA-256 каждого файла, публикует версию для игроков и перезапускается. Если новая версия не ответит за 2 минуты, вернётся предыдущая. Более старые сборки не ставятся.')}</small>
          <small>{uiText('По умолчанию установка ручная: ноутбук только скачивает и проверяет сборку, присылает уведомление и ждёт кнопки «Установить сейчас» (здесь или на сайте: Админ-панель → «Обновление»). Каждый шаг перезапуска пишется в self-update\\update-helper.log.')}</small>
          <small>{uiText('Токен: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token → Repository access: Only select repositories (только репозиторий релизов) → Permissions: Contents — Read-only, больше ничего. Токен хранится на этом компьютере в зашифрованном виде и больше не показывается.')}</small>
          <label><span>{uiText('Репозиторий релизов')}</span><input className="input" value={repo} maxLength={200} onChange={(event) => setRepo(event.target.value)} placeholder="proraa69-creator/raidos-releases" autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Токен GitHub')}</span><input className="input" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder={uiText(view.hasToken ? 'Сохранён. Оставьте пустым, чтобы не менять' : 'github_pat_… (Contents: Read-only)')} autoComplete="off" spellCheck={false} /></label>
          <label><span>{uiText('Когда устанавливать')}</span>
            <select className="input" value={view.window} onChange={(event) => save({ window: windowOf(event.target.value) })} disabled={busy}>
              <option value="manual">{uiText('Вручную: скачать и проверить, установить кнопкой «Установить сейчас» (рекомендуется)')}</option>
              <option value="any">{uiText('Сразу, в любое время')}</option>
              <option value="night">{uiText('Только ночью, 03:00–06:00')}</option>
            </select>
          </label>
          <small>{uiText('Последняя проверка')}: {when(updater.checkedAt)} · {uiText('следующая проверка')}: {when(view.nextCheckAt)}{view.previous ? ` · ${uiText('предыдущая версия')}: ${build(view.previous)}` : ''}</small>
          {view.history.slice(0, 3).map((entry) => (
            <div key={`${entry.at}-${entry.to.build}`} style={{ display: 'grid', gap: 4 }}>
              <small style={{ color: entry.result === 'ok' ? undefined : 'var(--danger)' }}>
                {when(entry.at)} · {uiText(entry.kind === 'update' ? 'Обновление сервера' : 'Откат сервера')} {build(entry.from)} → {build(entry.to)} · {uiText(entry.result === 'ok' ? 'прошло успешно' : entry.result === 'rolled-back' ? 'откачено на предыдущую' : 'не выполнено')}{entry.reason ? ` (${uiText(entry.reason)})` : ''}
              </small>
              {entry.log && <details><summary><small>{uiText('Журнал помощника обновления')}</small></summary><pre style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflow: 'auto', fontSize: 11 }}>{entry.log}</pre></details>}
            </div>
          ))}
          {message && <small style={{ color: message.ok ? 'var(--green)' : 'var(--danger)' }}>{uiText(message.text)}</small>}
          <span className="owner-actions">
            {view.hasToken && <button type="button" className="button ghost" disabled={busy} onClick={() => run(() => api.setServerUpdate!({ enabled: false, clearToken: true }), 'Токен удалён')}>{uiText('Удалить токен')}</button>}
            {view.previous && api.rollbackServerUpdate && !view.unsupported && <button type="button" className="button ghost" disabled={busy || Boolean(view.restart)} onClick={rollback}><Undo2 size={14} />{uiText('Откатить на предыдущую')}</button>}
            {view.enabled && api.checkServerUpdate && <button type="button" className="button" disabled={busy || Boolean(view.restart)} onClick={() => run(() => api.checkServerUpdate!())}><RefreshCw size={14} />{uiText('Проверить сейчас')}</button>}
            <button className="button primary" type="submit" disabled={busy}>{uiText('Сохранить')}</button>
          </span>
        </form>
      )}
    </div>
  )
}
