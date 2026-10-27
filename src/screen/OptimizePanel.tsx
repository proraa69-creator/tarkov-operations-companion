import { useEffect, useState } from 'react'
import { CheckCircle2, CircleSlash, Cpu, RotateCcw, Zap } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { screenApi, type OptimizeStatus } from './screenApi'


/**
 * «Оптимизация ПК» (electron/screenTuning/optimizer.ts): what Windows offers for games, every step reversible; heavy
 * programs are only listed.
 */
export function OptimizePanel() {
  const api = screenApi()
  const [status, setStatus] = useState<OptimizeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ done: string[]; skipped: string[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { if (api) void api.optimizeStatus().then(setStatus).catch(() => setError('Не удалось проверить компьютер.')) }, [api])

  const run = async (revert: boolean) => {
    if (!api) return
    setBusy(true)
    setError('')
    try {
      if (revert) {
        const result = await api.revertOptimize()
        setStatus(result.status)
        setReport({ done: result.done.length ? ['Настройки Windows возвращены как были'] : [], skipped: [] })
      } else {
        const result = await api.optimize()
        setStatus(result.status)
        setReport({ done: result.done, skipped: result.skipped })
      }
    } catch {
      setError('Не удалось выполнить действие.')
    } finally {
      setBusy(false)
    }
  }

  const row = (label: string, good: boolean | null, value: string) => (
    <li className={`optimize-row ${good === null ? '' : good ? 'is-good' : 'is-bad'}`}>
      {good === false ? <CircleSlash aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <span>{uiText(label)}</span>
      <strong>{uiText(value)}</strong>
    </li>
  )

  return (
    <div className="optimize">
      <section className="panel optimize-main">
        <div className="panel-header"><h2><Cpu aria-hidden="true" /> {uiText('Оптимизация компьютера')}</h2></div>
        <div className="optimize-body">
          <p className="optimize-intro">{uiText('Только то, что Windows сам предлагает для игр: ничего не разгоняется, игра и её файлы не трогаются. Каждый шаг отменяется кнопкой «Вернуть как было».')}</p>
          {status ? (
            <ul className="optimize-list">
              {row('Схема питания', status.power ? status.power.isHigh : null, status.power ? status.power.name || '—' : 'неизвестно')}
              {row('Игровой режим Windows', status.gameMode, status.gameMode === null ? 'неизвестно' : status.gameMode ? 'включён' : 'выключен')}
              {row('Аппаратное планирование GPU', null, status.gpuScheduling === null ? 'неизвестно' : status.gpuScheduling ? 'включено' : 'выключено')}
            </ul>
          ) : <p className="optimize-intro">{uiText(error || 'Проверяем компьютер…')}</p>}
          {status?.onBattery && <p className="optimize-note">{uiText('Ноутбук работает от батареи: схему питания не меняем.')}</p>}
          <div className="optimize-actions">
            <button type="button" className="button primary" disabled={busy || !status?.windows} onClick={() => void run(false)}><Zap aria-hidden="true" />{uiText('Оптимизировать компьютер')}</button>
            <button type="button" className="button" disabled={busy || !status?.canRevert} onClick={() => void run(true)}><RotateCcw aria-hidden="true" />{uiText('Вернуть как было')}</button>
          </div>
          {report && (
            <ul className="optimize-report">
              {report.done.map((line) => <li key={line} className="is-good">{uiText(line)}</li>)}
              {report.skipped.map((line) => <li key={line} className="is-skipped">{uiText(line)}</li>)}
            </ul>
          )}
          {error && status && <p className="optimize-note is-error">{uiText(error)}</p>}
        </div>
      </section>
      <div className="optimize-side">
        <section className="panel">
          <div className="panel-header"><h2>{uiText('Программы рядом с игрой')}</h2></div>
          <div className="optimize-body">
            {status && !status.heavy.length && <p className="optimize-intro">{uiText('Тяжёлых программ не видно.')}</p>}
            {status && status.heavy.length > 0 && <>
              <p className="optimize-intro">{uiText('Закройте их перед рейдом сами — приложение ничего не закрывает.')}</p>
              <ul className="optimize-heavy">
                {status.heavy.map((program) => <li key={program.label}><strong>{program.label}</strong><span>{uiText(program.why)}</span><small>{program.memoryMb} {uiText('МБ')}</small></li>)}
              </ul>
            </>}
          </div>
        </section>
      </div>
    </div>
  )
}
