import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, CircleSlash, Cpu, ExternalLink, RotateCcw, Zap } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { screenApi, type OptimizeItem, type OptimizeItemId, type OptimizeStatus, type PcInfo } from './screenApi'

type Mode = 'normal' | 'advanced'

const MODE_NOTE: Record<Mode, string> = {
  normal: 'Настройки Windows для игр: применяются сразу, права администратора не нужны.',
  advanced: 'Всё из обычной и больше: часть пунктов просит права администратора (Windows спросит) и работает после перезагрузки.',
}

/**
 * «Оптимизация ПК» (electron/screenTuning/optimizer.ts; owner, 03.11.2026: «обычная оптимизация и продвинутая
 * оптимизация… покажи человеку список… галочки что оптимизировать и кнопка подтвердить или отменить, при нажатии
 * подтвердить, появляется окно да нет»). «Ваш компьютер» from Windows, the steps of the chosen mode with their ticks
 * (the recommended ones ticked), «Да» / «Нет» before anything changes, every step undone with «Вернуть как было»; what the
 * app cannot do itself comes as tips. Heavy programs beside the game are only listed.
 */
export function OptimizePanel() {
  const api = screenApi()
  const [status, setStatus] = useState<OptimizeStatus | null>(null)
  const [mode, setMode] = useState<Mode>('normal')
  /** The player's own ticks over the recommended ones. */
  const [ticks, setTicks] = useState<Partial<Record<OptimizeItemId, boolean>>>({})
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<{ done: string[]; skipped: string[]; restart?: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { if (api) void api.optimizeStatus().then(setStatus).catch(() => setError('Не удалось проверить компьютер.')) }, [api])

  // «Игра на мощной видеокарте» only where there is a choice (owner, 03.11.2026: crossed out on a PC with one card).
  const items = (status?.items ?? []).filter((item) => (mode === 'advanced' || item.level === 'normal') && (item.id !== 'gameGpu' || item.available))
  const open = (item: OptimizeItem) => item.available && !item.done
  const ticked = (item: OptimizeItem) => open(item) && (ticks[item.id] ?? item.recommended)
  const chosen = items.filter(ticked)

  const apply = async () => {
    if (!api) return
    setAsking(false)
    setBusy(true)
    setError('')
    try {
      const result = await api.optimize(chosen.map((item) => item.id))
      setStatus(result.status)
      setTicks({})
      setReport({ done: result.done, skipped: result.skipped, restart: result.restart })
    } catch {
      setError('Не удалось выполнить действие.')
    } finally {
      setBusy(false)
    }
  }

  const revert = async () => {
    if (!api) return
    setBusy(true)
    setError('')
    try {
      const result = await api.revertOptimize()
      setStatus(result.status)
      setTicks({})
      setReport({ done: result.done.length ? ['Настройки Windows возвращены как были'] : [], skipped: [], restart: result.restart })
    } catch {
      setError('Не удалось выполнить действие.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="optimize">
      <section className="panel optimize-main">
        <div className="panel-header"><h2><Cpu aria-hidden="true" /> {uiText('Оптимизация компьютера')}</h2></div>
        <div className="optimize-body">
          <p className="optimize-intro">{uiText('Отметьте, что оптимизировать. Ничего не разгоняется, игра и её файлы не трогаются, каждый шаг отменяется кнопкой «Вернуть как было».')}</p>
          <div className="optimize-modes" role="tablist" aria-label={uiText('Оптимизация')}>
            {(['normal', 'advanced'] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={mode === value} className={mode === value ? 'is-active' : ''} onClick={() => setMode(value)}>
                {uiText(value === 'normal' ? 'Обычная' : 'Продвинутая')}
              </button>
            ))}
          </div>
          <p className="optimize-intro optimize-mode-note">{uiText(MODE_NOTE[mode])}</p>
          {status ? (
            items.length ? (
              <ul className="optimize-items">
                {items.map((item) => <ItemRow key={item.id} item={item} checked={ticked(item)} onToggle={() => setTicks((current) => ({ ...current, [item.id]: !ticked(item) }))} />)}
              </ul>
            ) : <p className="optimize-intro">{uiText('Список недоступен: оптимизация работает только в Windows.')}</p>
          ) : <p className="optimize-intro">{uiText(error || 'Проверяем компьютер…')}</p>}
          {status?.onBattery && <p className="optimize-note">{uiText('Ноутбук работает от батареи: схему питания не меняем.')}</p>}
          <div className="optimize-actions">
            <button type="button" className="button primary" disabled={busy || !status?.windows || !chosen.length} onClick={() => setAsking(true)}>
              <Zap aria-hidden="true" />{uiText('Подтвердить')}{chosen.length ? ` (${chosen.length})` : ''}
            </button>
            <button type="button" className="button" disabled={busy} onClick={() => { setTicks({}); setReport(null) }}>{uiText('Отменить')}</button>
            <button type="button" className="button ghost" disabled={busy || !status?.canRevert} onClick={() => void revert()}><RotateCcw aria-hidden="true" />{uiText('Вернуть как было')}</button>
          </div>
          {busy && <p className="optimize-note">{uiText('Применяем… Если Windows спросит разрешение администратора, нажмите «Да».')}</p>}
          {report && (
            <ul className="optimize-report">
              {report.done.map((line) => <li key={line} className="is-good">{uiText(line)}</li>)}
              {report.skipped.map((line) => <li key={line} className="is-skipped">{uiText(line)}</li>)}
            </ul>
          )}
          {report?.restart && <p className="optimize-note">{uiText('Перезагрузите компьютер, чтобы изменения заработали.')}</p>}
          {error && status && <p className="optimize-note is-error">{uiText(error)}</p>}
        </div>
      </section>
      <div className="optimize-side">
        {status && 'pc' in status && <PcCard pc={status.pc ?? null} />}
        {status?.tips && status.tips.length > 0 && (
          <section className="panel">
            <div className="panel-header"><h2>{uiText('Что сделать самому')}</h2></div>
            <div className="optimize-body">
              {status.tips.map((tip) => (
                <article key={`${tip.id}:${tip.title}`} className="optimize-tip">
                  <strong>{uiText(tip.title)}</strong>
                  <p>{uiText(tip.text)}</p>
                  {tip.steps && <ul>{tip.steps.map((step) => <li key={step}>{uiText(step)}</li>)}</ul>}
                  {tip.open && api?.openOptimizeTool && (
                    <button type="button" className="button small" onClick={() => void api.openOptimizeTool?.(tip.open!)}><ExternalLink aria-hidden="true" />{uiText(tip.openLabel ?? 'Открыть')}</button>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
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
      {asking && <ConfirmDialog items={chosen} onYes={() => void apply()} onNo={() => setAsking(false)} />}
    </div>
  )
}

function ItemRow({ item, checked, onToggle }: { item: OptimizeItem; checked: boolean; onToggle: () => void }) {
  const id = `optimize-item-${item.id}`
  const choosable = item.available && !item.done
  return (
    <li className={`optimize-item${item.done ? ' is-done' : ''}${!item.available ? ' is-off' : ''}`}>
      {choosable
        ? <input id={id} type="checkbox" checked={checked} onChange={onToggle} />
        : item.done ? <CheckCircle2 className="optimize-item-mark" aria-hidden="true" /> : <CircleSlash className="optimize-item-mark" aria-hidden="true" />}
      <label htmlFor={choosable ? id : undefined} className="optimize-item-copy">
        <strong>{uiText(item.title)}</strong>
        <span>{uiText(item.why)}</span>
        {/* Only what is already done; no «Сейчас: …» and no reason a step is off (owner, 03.11.2026: crossed out). */}
        {item.done && <small>{uiText('Уже сделано')} · {uiText(item.now)}</small>}
        {choosable && (item.admin || item.after) && (
          <span className="optimize-item-tags">
            {item.admin && <span className="tag">{uiText('Права администратора')}</span>}
            {item.after === 'restart' && <span className="tag">{uiText('После перезагрузки')}</span>}
            {item.after === 'signIn' && <span className="tag">{uiText('После повторного входа в Windows')}</span>}
          </span>
        )}
      </label>
    </li>
  )
}

/** «Да» / «Нет» before anything changes; Escape and the backdrop mean «Нет». */
function ConfirmDialog({ items, onYes, onNo }: { items: OptimizeItem[]; onYes: () => void; onNo: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onNo() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNo])
  return createPortal(
    <div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onNo() }}>
      <section className="panel registration-dialog optimize-confirm" role="alertdialog" aria-modal="true" aria-labelledby="optimize-confirm-title">
        <h2 id="optimize-confirm-title">{uiText('Применить выбранное?')}</h2>
        <ul>{items.map((item) => <li key={item.id}>{uiText(item.title)}</li>)}</ul>
        {items.some((item) => item.admin) && <p className="optimize-note">{uiText('Windows спросит разрешение администратора — нажмите «Да» в его окне.')}</p>}
        {items.some((item) => item.after === 'restart') && <p className="optimize-note">{uiText('Часть изменений заработает после перезагрузки компьютера.')}</p>}
        <div className="optimize-confirm-actions">
          <button type="button" className="button primary" autoFocus onClick={onYes}>{uiText('Да')}</button>
          <button type="button" className="button" onClick={onNo}>{uiText('Нет')}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}

const day = (iso: string) => iso.split('-').reverse().join('.')
const gbOf = (mb: number) => `${Math.round(mb / 1024)} ${uiText('ГБ')}`

/** «Ваш компьютер»: what Windows says about the processor, the video cards and their drivers, memory, disks. */
function PcCard({ pc }: { pc: PcInfo | null }) {
  const rows: Array<{ label: string; value: string; note?: string; bad?: boolean }> = []
  if (pc?.cpu) rows.push({ label: 'Процессор', value: pc.cpu.name, note: pc.cpu.cores ? `${pc.cpu.cores} ${uiText('ядер')} / ${pc.cpu.threads} ${uiText('потоков')}` : undefined })
  for (const gpu of pc?.gpus ?? []) {
    rows.push(gpu.noDriver
      ? { label: 'Видеокарта', value: gpu.name, note: uiText('драйвер не установлен'), bad: true }
      : { label: 'Видеокарта', value: gpu.name, note: `${uiText('драйвер')} ${gpu.driver}${gpu.driverDate ? ` ${uiText('от')} ${day(gpu.driverDate)}` : ''}` })
  }
  if (pc?.ramGb) {
    const speed = pc.ramMhz
    const note = !speed ? undefined
      : speed.running < speed.rated * 0.95
        ? `${speed.running} ${uiText('МГц')} (${uiText('модули на')} ${speed.rated} ${uiText('МГц')}${speed.locked ? `, ${uiText('плата выше не даёт — это нормально')}` : ''})`
        : `${speed.running} ${uiText('МГц')}`
    rows.push({ label: 'Память', value: `${pc.ramGb} ${uiText('ГБ')}`, note, bad: Boolean(speed && speed.running < speed.rated * 0.95 && !speed.locked) || pc.ramGb < 16 })
  }
  if (pc?.board) rows.push({ label: 'Материнская плата', value: pc.board })
  if (pc?.windows) rows.push({ label: 'Windows', value: pc.windows.name, note: pc.windows.build ? `${uiText('сборка')} ${pc.windows.build}` : undefined })
  if (pc?.pageFile) {
    const page = pc.pageFile
    rows.push({
      label: 'Файл подкачки',
      value: page.automatic ? uiText('размер выбирает Windows') : page.files.length ? page.files.map((file) => file.maxMb ? `${file.path.slice(0, 2)} ${gbOf(file.initialMb)}–${gbOf(file.maxMb)}` : `${file.path.slice(0, 2)} ${uiText('по выбору Windows')}`).join(', ') : uiText('выключен'),
      bad: !page.automatic && !page.files.length,
    })
  }
  if (pc?.game) rows.push({ label: 'Игра', value: `${pc.game.drive}:`, note: pc.game.media === 'unknown' ? undefined : pc.game.media, bad: pc.game.media === 'HDD' })
  return (
    <section className="panel">
      <div className="panel-header"><h2>{uiText('Ваш компьютер')}</h2></div>
      <div className="optimize-body">
        {!pc && <p className="optimize-intro">{uiText('Windows не рассказал о железе: список ниже всё равно работает.')}</p>}
        {rows.length > 0 && (
          <dl className="optimize-pc">
            {rows.map((row, index) => (
              <div key={`${row.label}:${index}`} className={row.bad ? 'is-bad' : ''}>
                <dt>{uiText(row.label)}</dt>
                <dd>{row.value}{row.note && <small>{row.note}</small>}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  )
}
