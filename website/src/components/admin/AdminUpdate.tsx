import { CheckCircle2, CircleX, DownloadCloud, History, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Notice } from '../Notice'
import { Loading } from './adminShared'
import { dateTime, failure, numberFormat, useAdminData, type Failure } from './adminData'
import { updateApi, type BuildRef, type HistoryEntry, type SelfUpdateStatus, type UpdateView } from './updateApi'
import '../../admin-security.css'
import '../../admin-update.css'

const PHASE: Record<SelfUpdateStatus['updater']['phase'], string> = {
  off: 'Автообновление выключено', idle: 'Установлена последняя версия', checking: 'Проверяю GitHub…', downloading: 'Скачиваю новую версию…',
  verifying: 'Проверяю подпись и контрольные суммы…', ready: 'Новая версия скачана и проверена', installing: 'Устанавливаю…', error: 'Ошибка автообновления',
}
const RESTART_PHASE: Record<string, string> = {
  restarting: 'Перезапуск сервера…', checking: 'Проверка здоровья новой версии (до 2 минут)…', 'rolling-back': 'Новая версия не ответила — возвращаю предыдущую…',
  ok: 'Проверка пройдена', 'rolled-back': 'Откачено на предыдущую версию', failed: 'Не удалось',
}
const RESULT: Record<HistoryEntry['result'], { label: string; tone: string }> = {
  ok: { label: 'успешно', tone: 'green' }, 'rolled-back': { label: 'откат', tone: 'danger' }, failed: { label: 'не удалось', tone: 'danger' },
}
const build = (value: BuildRef) => `${value.version} · ${value.build}${value.commit ? ` · ${value.commit}` : ''}`
const when = (iso?: string) => (iso ? dateTime.format(new Date(iso)) : '—')
const megabytes = (bytes: number) => `${(Math.round(bytes / 1024 / 102.4) / 10).toLocaleString('ru-RU')} МБ`
const BUSY_PHASES = new Set(['checking', 'downloading', 'verifying', 'installing'])

function lampOf(status: SelfUpdateStatus): { tone: 'green' | 'amber' | 'red' | 'grey'; title: string; text: string } {
  const updater = status.updater
  if (status.restart) return { tone: 'amber', title: RESTART_PHASE[status.restart.phase] ?? 'Перезапуск…', text: `${status.restart.kind === 'update' ? 'Обновление' : 'Откат'}: ${status.restart.from.version} → ${status.restart.to.version}. Сайт может не открываться около минуты.` }
  if (status.unsupported) return { tone: 'grey', title: 'Автообновление здесь недоступно', text: status.unsupported }
  if (!status.enabled) return { tone: 'grey', title: PHASE.off, text: 'Включите его в приложении на ноутбуке: «Сервер» → «Автообновление сервера».' }
  const recent = status.history[0]
  if (updater.phase === 'error') return { tone: 'red', title: PHASE.error, text: updater.error ?? updater.message }
  if (recent && recent.result !== 'ok' && Date.now() - Date.parse(recent.at) < 24 * 3600_000) {
    return { tone: 'red', title: recent.result === 'rolled-back' ? 'Последнее обновление откачено' : 'Последнее обновление не удалось', text: recent.reason ?? '' }
  }
  if (BUSY_PHASES.has(updater.phase) || updater.phase === 'ready') return { tone: 'amber', title: PHASE[updater.phase], text: updater.waitingForWindow ? 'Установка ночью, 03:00–06:00 (время ноутбука).' : updater.message }
  return { tone: 'green', title: PHASE.idle, text: `Сервер проверяет репозиторий релизов каждые 15 минут. Последняя проверка: ${when(updater.checkedAt)}.` }
}

/**
 * «Обновление»: how the server laptop updates itself (docs/laptop-server.md «Автообновление сервера»): the installed and
 * previous build, the download per file, the signature and checksum results, the restart with its 2-minute health
 * check, the history with rollbacks; «Проверить сейчас» and «Откатить на предыдущую». Settings (repository, token,
 * install window) exist only in the app on the laptop.
 */
export function AdminUpdate() {
  const view = useAdminData(useCallback((token: string) => updateApi.view(token), []))
  const [action, setAction] = useState<'check' | 'rollback' | null>(null)
  const [actionError, setActionError] = useState<Failure | null>(null)
  const data: UpdateView | null = view.data
  const status = data?.available ? data.status : null
  const busy = Boolean(status && (status.restart || BUSY_PHASES.has(status.updater.phase)))
  // Faster while something happens; the restart itself shows up as a short network failure.
  const { reload } = view
  const offline = Boolean(view.error?.offline)
  useEffect(() => {
    const timer = window.setInterval(() => void reload(), busy || offline ? 3000 : 30_000)
    return () => window.clearInterval(timer)
  }, [busy, offline, reload])

  const run = (kind: 'check' | 'rollback') => {
    if (!view.token) return
    if (kind === 'rollback' && status?.previous && !window.confirm(`Откатить сервер на предыдущую версию ${build(status.previous)}?\n\nСервер перезапустится (около минуты). Текущая сборка больше не будет ставиться автоматически.`)) return
    setAction(kind)
    setActionError(null)
    void (kind === 'check' ? updateApi.check(view.token) : updateApi.rollback(view.token))
      .then((next) => view.setData(next), (reason: unknown) => setActionError(failure(reason)))
      .finally(() => setAction(null))
  }

  return (
    <div className="admin-stack">
      {view.error && (status?.restart || view.error.offline
        ? <Notice tone="offline">Сервер не отвечает — скорее всего, он перезапускается после обновления. Страница обновится сама.</Notice>
        : <Notice tone="error">{view.error.message}</Notice>)}
      {!data && !view.error && <Loading text="Загружаем состояние обновлений…" />}
      {data && !data.available && <Notice tone="info" title="Автообновление недоступно">{data.reason}</Notice>}
      {status && (
        <>
          <StatusStrip status={status} loading={view.loading} onRefresh={() => void view.refresh()} />
          {actionError && <Notice tone={actionError.offline ? 'offline' : 'error'}>{actionError.message}</Notice>}
          <section className="admin-section" aria-labelledby="update-versions-title">
            <div className="admin-section-head"><h2 className="panel-title" id="update-versions-title"><ShieldCheck aria-hidden="true" />Версии</h2></div>
            <dl className="update-facts">
              <div><dt>Установлена</dt><dd className="mono">{build(status.current)}</dd></div>
              <div><dt>Предыдущая</dt><dd className="mono">{status.previous ? build(status.previous) : 'ещё нет (появится после первого автообновления)'}</dd></div>
              {status.updater.latest && <div><dt>На GitHub</dt><dd className="mono">{build(status.updater.latest)}</dd></div>}
              <div><dt>Репозиторий</dt><dd className="mono">{status.repo}{status.hasToken ? '' : ' · токен не задан'}</dd></div>
              <div><dt>Когда ставить</dt><dd>{status.window === 'night' ? 'только ночью, 03:00–06:00' : 'сразу'}</dd></div>
              <div><dt>Проверки</dt><dd>последняя {when(status.updater.checkedAt)} · следующая {when(status.nextCheckAt)}</dd></div>
              {status.skipped.length > 0 && <div><dt>Не ставятся</dt><dd className="mono">{status.skipped.join(', ')}</dd></div>}
            </dl>
            <div className="update-actions">
              <button type="button" className="button" disabled={action !== null || busy || !status.enabled || Boolean(status.unsupported)} onClick={() => run('check')}>
                {action === 'check' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}Проверить сейчас
              </button>
              <button type="button" className="button ghost admin-danger" disabled={action !== null || busy || !status.previous || Boolean(status.unsupported)} onClick={() => run('rollback')}>
                {action === 'rollback' ? <LoaderCircle className="spinner" aria-hidden="true" /> : <Undo2 aria-hidden="true" />}Откатить на предыдущую
              </button>
            </div>
            <p className="field-hint" style={{ margin: 0 }}>Репозиторий, токен и время установки меняются только в приложении на ноутбуке. Сайт не может передать ноутбуку файл: сервер ставит только сборки, подпись которых проверил сам.</p>
          </section>
          {status.updater.files.length > 0 && <FilesSection status={status} />}
          {status.updater.checks.length > 0 && (
            <section className="admin-section" aria-labelledby="update-checks-title">
              <div className="admin-section-head"><h2 className="panel-title" id="update-checks-title"><ShieldCheck aria-hidden="true" />Проверка</h2></div>
              <ul className="update-checks">
                {status.updater.checks.map((check) => (
                  <li key={check.label} className={check.ok ? 'is-ok' : 'is-bad'}>
                    {check.ok ? <CheckCircle2 aria-hidden="true" /> : <CircleX aria-hidden="true" />}
                    <span className="mono">{check.label}</span>
                    {check.detail && <span className="muted">{check.detail}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {status.restart && <RestartSection status={status} />}
          <HistorySection history={status.history} />
        </>
      )}
    </div>
  )
}

function StatusStrip({ status, loading, onRefresh }: { status: SelfUpdateStatus; loading: boolean; onRefresh: () => void }) {
  const lamp = lampOf(status)
  return (
    <div className={`guard-strip is-${lamp.tone === 'grey' ? 'grey' : lamp.tone}`} role="status">
      <span className={`guard-lamp is-${lamp.tone}`} aria-hidden="true" />
      <div className="guard-strip-text">
        <strong>{lamp.title}</strong>
        {lamp.text && <span>{lamp.text}</span>}
      </div>
      <button type="button" className="button small ghost" onClick={onRefresh} disabled={loading}>
        <RefreshCw aria-hidden="true" className={loading ? 'spinner' : undefined} />Обновить
      </button>
    </div>
  )
}

function FilesSection({ status }: { status: SelfUpdateStatus }) {
  const files = status.updater.files
  const total = files.reduce((sum, file) => sum + file.size, 0)
  const done = files.reduce((sum, file) => sum + file.done, 0)
  return (
    <section className="admin-section" aria-labelledby="update-files-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="update-files-title"><DownloadCloud aria-hidden="true" />Загрузка с GitHub</h2>
        <span className="muted guard-small mono">{megabytes(done)} из {megabytes(total)}</span>
      </div>
      <ul className="update-files">
        {files.map((file) => {
          const percent = file.size ? Math.min(100, Math.floor((file.done / file.size) * 100)) : 0
          return (
            <li key={file.name} className={`is-${file.state}`}>
              <span className="mono">{file.name}</span>
              <span className="update-bar" role="progressbar" aria-label={file.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></span>
              <span className="mono update-percent">{file.state === 'error' ? 'ошибка' : file.state === 'ok' ? 'проверен' : `${percent}%`}</span>
            </li>
          )
        })}
      </ul>
      <p className="field-hint" style={{ margin: 0 }}>Каждая часть проверяется по подписанному размеру и SHA-256; прерванная загрузка продолжается с первой непроверенной части.</p>
    </section>
  )
}

function RestartSection({ status }: { status: SelfUpdateStatus }) {
  const restart = status.restart!
  const steps = [
    { id: 'restarting', label: 'Замена exe и перезапуск' },
    { id: 'checking', label: 'Проверка здоровья: API и сайт новой версии, до 2 минут' },
    { id: 'done', label: 'Готово (или автоматический откат)' },
  ]
  const index = restart.phase === 'restarting' ? 0 : restart.phase === 'checking' ? 1 : 2
  return (
    <section className="admin-section" aria-labelledby="update-restart-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="update-restart-title"><RotateCcw aria-hidden="true" />{restart.kind === 'update' ? 'Установка' : 'Откат'}: {restart.from.version} → {restart.to.version}</h2>
        <span className="muted guard-small">начато {when(restart.startedAt)}</span>
      </div>
      <ol className="update-steps">
        {steps.map((step, position) => (
          <li key={step.id} className={position < index ? 'is-done' : position === index ? 'is-current' : ''}>
            {position < index ? <CheckCircle2 aria-hidden="true" /> : position === index ? <LoaderCircle className="spinner" aria-hidden="true" /> : <span className="update-dot" aria-hidden="true" />}
            {step.label}
          </li>
        ))}
      </ol>
    </section>
  )
}

function HistorySection({ history }: { history: HistoryEntry[] }) {
  return (
    <section className="admin-section" aria-labelledby="update-history-title">
      <div className="admin-section-head">
        <h2 className="panel-title" id="update-history-title"><History aria-hidden="true" />История</h2>
        <span className="muted guard-small">последние {numberFormat.format(Math.min(history.length, 30))}</span>
      </div>
      {history.length === 0 ? <div className="muted admin-empty">Автообновлений ещё не было.</div> : (
        <ul className="update-history">
          {history.map((entry) => (
            <li key={`${entry.at}-${entry.to.build}-${entry.kind}`}>
              <div className="update-history-head">
                <span className="mono">{when(entry.at)}</span>
                <span className={`tag ${RESULT[entry.result].tone}`}>{entry.kind === 'rollback' ? 'откат вручную · ' : ''}{RESULT[entry.result].label}</span>
              </div>
              <div className="mono update-history-builds">{entry.from.version} ({entry.from.build}) → {entry.to.version} ({entry.to.build})</div>
              {entry.reason && <div className="muted update-history-reason">{entry.reason}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
