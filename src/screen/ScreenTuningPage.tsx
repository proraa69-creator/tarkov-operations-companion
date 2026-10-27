import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Camera, Copy, Eye, Image as ImageIcon, MonitorCog, Pencil, Save, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { autoProfile } from './autoTune'
import { BeforeAfter } from './BeforeAfter'
import { CurveEditor, type CurveChannel } from './CurveEditor'
import { OptimizePanel } from './OptimizePanel'
import { LIMITS, screenTables, type CurvePoint, type ScreenProfile } from './screenCurve'
import { screenApi, type ScreenFrame, type ScreenTuningView } from './screenApi'
import './screenTuning.css'

type Slider = { key: 'gamma' | 'shadows' | 'highlights' | 'contrast' | 'brightness' | 'temperature' | 'tint'; label: string; step: number; show: (value: number) => string }

const percent = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`
const SLIDERS: Slider[] = [
  { key: 'gamma', label: 'Гамма (средние тона)', step: 0.01, show: (value) => value.toFixed(2) },
  { key: 'shadows', label: 'Тени', step: 0.01, show: percent },
  { key: 'highlights', label: 'Светлые участки', step: 0.01, show: percent },
  { key: 'contrast', label: 'Контраст', step: 0.01, show: percent },
  { key: 'brightness', label: 'Яркость', step: 0.005, show: percent },
  { key: 'temperature', label: 'Основной цвет: холоднее — теплее', step: 0.01, show: percent },
  { key: 'tint', label: 'Оттенок: зелёный — пурпурный', step: 0.01, show: percent },
]

const CHANNELS: Array<{ id: CurveChannel; label: string }> = [{ id: 'all', label: 'Все' }, { id: 'r', label: 'R' }, { id: 'g', label: 'G' }, { id: 'b', label: 'B' }]

/** A small picture of a preset's curve for its card. */
function CurveThumb({ profile }: { profile: ScreenProfile }) {
  const d = useMemo(() => {
    const table = screenTables(profile).g
    return Array.from({ length: 33 }, (_, index) => `${index ? 'L' : 'M'}${index * 2},${(1 - table[Math.min(255, index * 8)]!) * 64}`).join(' ')
  }, [profile])
  return <svg className="screen-thumb" viewBox="0 0 64 64" aria-hidden="true"><path className="curve-diagonal" d="M0,64 L64,0" /><path d={d} /></svg>
}

const ago = (at: number, en: boolean) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (en) return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : 'a while ago'
  return minutes < 1 ? 'только что' : minutes < 60 ? `${minutes} мин назад` : 'давно'
}

/**
 * «Настройка экрана» (owner, 27.10.2026): presets and a hand-made curve for the monitor while the game is in front —
 * dark corridors and night raids lighter. The game's picture is cut in two: before on the left, after on the right.
 * «Оптимизация ПК» is the second tab.
 */
export function ScreenTuningPage() {
  const api = screenApi()
  const en = useLocale().locale === 'en'
  /** A sentence built from values: both languages here (the dictionary holds only fixed phrases). */
  const say = (ru: string, english: string) => en ? english : ru
  const [tab, setTab] = useState<'screen' | 'pc'>('screen')
  const [view, setView] = useState<ScreenTuningView | null>(null)
  const [frame, setFrame] = useState<ScreenFrame | null>(null)
  const [frameNote, setFrameNote] = useState('')
  const [draft, setDraft] = useState<ScreenProfile | null>(null)
  const [channel, setChannel] = useState<CurveChannel>('all')
  const [trying, setTrying] = useState(false)
  const [error, setError] = useState('')
  const pixels = useRef<Uint8ClampedArray | null>(null)

  useEffect(() => {
    if (!api) return
    void api.state().then(setView).catch(() => setError('Не удалось загрузить настройки экрана.'))
    void api.frame('last').then((found) => { if (found) setFrame(found) }).catch(() => {})
    const timer = setInterval(() => { void api.state().then(setView).catch(() => {}) }, 3000)
    return () => { clearInterval(timer); void api.tryProfile(null).catch(() => {}) }
  }, [api])

  const active = view?.presets.find((preset) => preset.id === view.settings.activeId) ?? view?.presets[0] ?? null
  const shown = draft ?? active

  // «Попробовать на экране»: the draft on every monitor while it changes.
  useEffect(() => {
    if (!api) return
    const timer = setTimeout(() => { void api.tryProfile(trying && draft ? draft : null).catch(() => {}) }, 120)
    return () => clearTimeout(timer)
  }, [api, trying, draft])

  const perform = async (action: () => Promise<unknown>) => {
    setError('')
    try { await action() } catch (problem) { setError(problem instanceof Error ? problem.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Не удалось выполнить действие.') }
  }
  const update = (patch: Parameters<NonNullable<typeof api>['update']>[0]) => perform(async () => { if (api) setView(await api.update(patch)) })

  const takeFrame = (kind: 'game' | 'screenshot') => perform(async () => {
    if (!api) return
    const found = await api.frame(kind)
    if (found) { setFrame(found); setFrameNote('') }
    else setFrameNote(kind === 'game' ? 'Окно игры не видно: откройте игру на экране или используйте её скриншот.' : 'Скриншотов игры пока нет: нажмите в игре клавишу скриншота (по умолчанию Print Screen).')
  })

  const onPixels = useCallback((data: Uint8ClampedArray) => { pixels.current = data }, [])

  const startEditing = (from: ScreenProfile, copy: boolean) => {
    setDraft({ ...from, id: copy || from.builtIn ? '' : from.id, name: copy || from.builtIn ? `${uiText(from.name)} ${say('(моя)', '(mine)')}` : from.name, builtIn: undefined })
    setChannel('all')
  }
  const change = (patch: Partial<ScreenProfile>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const setCurve = (points: CurvePoint[]) => setDraft((current) => {
    if (!current) return current
    if (channel === 'all') return { ...current, curve: points }
    return { ...current, channels: { ...current.channels, [channel]: points } }
  })
  const save = () => perform(async () => {
    if (!api || !draft) return
    if (!draft.name.trim()) throw new Error('Напишите название пресета')
    const result = await api.savePreset({ ...draft, id: draft.id || 'new' })
    setView(result)
    setDraft(null)
    setTrying(false)
  })
  const remove = (preset: ScreenProfile) => perform(async () => {
    if (!api || !window.confirm(say(`Удалить пресет «${preset.name}»?`, `Delete the preset «${uiText(preset.name)}»?`))) return
    setView(await api.deletePreset(preset.id))
  })

  if (!api) {
    return <div className="page"><div className="panel empty-state">{uiText('Настройка экрана работает в приложении Raid OS для Windows.')}</div></div>
  }

  const status = view?.status
  return (
    <div className="page screen-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{uiText('Настройка экрана')}</h1>
          <p className="page-subtitle">{uiText('Тёмные коридоры и ночные рейды светлее: пресеты и своя кривая для монитора. Игра и её файлы не меняются — меняется только то, что показывает монитор.')}</p>
        </div>
        <div className="segmented-filter screen-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'screen'} className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><MonitorCog aria-hidden="true" />{uiText('Экран')}</button>
          <button type="button" role="tab" aria-selected={tab === 'pc'} className={tab === 'pc' ? 'active' : ''} onClick={() => setTab('pc')}>{uiText('Оптимизировать компьютер')}</button>
        </div>
      </header>

      {tab === 'pc' ? <OptimizePanel /> : <>
        <section className="panel screen-power">
          <label className="screen-switch">
            <input type="checkbox" checked={Boolean(view?.settings.enabled)} disabled={!view || !status?.available} onChange={(event) => void update({ enabled: event.target.checked })} />
            <span>{uiText('Включить в игре')}</span>
          </label>
          <select className="select screen-when" value={view?.settings.when ?? 'game'} disabled={!view} onChange={(event) => void update({ when: event.target.value === 'always' ? 'always' : 'game' })}>
            <option value="game">{uiText('Только когда игра на экране')}</option>
            <option value="always">{uiText('Всегда, пока открыто приложение')}</option>
          </select>
          <span className="screen-state">
            {!status ? '' : !status.available ? uiText('Windows не даёт менять гамму монитора на этом компьютере.')
              : status.applied ? (() => { const name = uiText(status.trial ? draft?.name ?? '' : active?.name ?? ''), strength = Math.round(status.applied.strength * 100); return status.applied.strength < 1 ? say(`Сейчас на экране: «${name}», Windows разрешил ${strength}% силы`, `On the screen now: «${name}», Windows allowed ${strength}% of it`) : say(`Сейчас на экране: «${name}»`, `On the screen now: «${name}»`) })()
              : view?.settings.enabled ? uiText(view.settings.when === 'game' ? 'Включится, когда окно игры будет на экране' : 'Включено') : uiText('Выключено')}
          </span>
          {status?.exclusive && <p className="screen-warning"><AlertTriangle aria-hidden="true" />{uiText('Игра в эксклюзивном полноэкранном режиме и может сбрасывать гамму. Поставьте в настройках графики режим «Безрамочный».')}</p>}
        </section>

        <div className="screen-grid">
          <section className="panel screen-preview">
            <div className="panel-header">
              <h2>{draft ? say(`Ручная настройка: ${draft.name || 'без названия'}`, `Manual tuning: ${draft.name || 'untitled'}`) : say(`Пресет: ${active?.name ?? ''}`, `Preset: ${uiText(active?.name ?? '')}`)}</h2>
              <div className="screen-sources">
                <button type="button" className="button small" onClick={() => void takeFrame('game')}><Camera aria-hidden="true" />{uiText('Снимок из игры')}</button>
                <button type="button" className="button small" onClick={() => void takeFrame('screenshot')}><ImageIcon aria-hidden="true" />{uiText('Последний скриншот игры')}</button>
              </div>
            </div>
            {shown && <BeforeAfter src={frame?.dataUrl ?? null} profile={shown} onPixels={onPixels} />}
            <p className="screen-frame-note">
              {frameNote ? uiText(frameNote) : frame ? say(`${frame.source === 'game' ? 'Кадр из игры' : 'Скриншот игры'}, ${ago(frame.at, false)}. Перетащите линию, чтобы сравнить.`, `${frame.source === 'game' ? 'A frame from the game' : 'A game screenshot'}, ${ago(frame.at, true)}. Drag the line to compare.`) : uiText('Когда вы в игре, приложение само берёт кадр раз в полминуты — откройте эту страницу после рейда или нажмите «Снимок из игры».')}
            </p>
          </section>

          <aside className="screen-side">
            {!draft ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>{uiText('Пресеты')}</h2>
                  <button type="button" className="button small primary" disabled={!active} onClick={() => active && startEditing(active, false)}><SlidersHorizontal aria-hidden="true" />{uiText('Настроить вручную')}</button>
                </div>
                <ul className="screen-presets">
                  {view?.presets.map((preset) => (
                    <li key={preset.id} className={preset.id === view.settings.activeId ? 'is-active' : ''}>
                      <button type="button" className="screen-preset" onClick={() => void update({ activeId: preset.id })}>
                        <CurveThumb profile={preset} />
                        <span><strong>{uiText(preset.name)}</strong><small>{uiText(preset.note ?? (preset.builtIn ? '' : 'Ваш пресет'))}</small></span>
                      </button>
                      <span className="screen-preset-tools">
                        {preset.builtIn
                          ? <button type="button" className="icon-button" title={uiText('Копировать и настроить')} onClick={() => startEditing(preset, true)}><Copy size={15} /></button>
                          : <>
                            <button type="button" className="icon-button" title={uiText('Изменить')} onClick={() => startEditing(preset, false)}><Pencil size={15} /></button>
                            <button type="button" className="icon-button" title={uiText('Удалить')} onClick={() => void remove(preset)}><Trash2 size={15} /></button>
                          </>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <section className="panel screen-editor">
                <div className="panel-header">
                  <h2>{uiText('Ручная настройка')}</h2>
                  <button type="button" className="icon-button" title={uiText('Закрыть без сохранения')} onClick={() => { setDraft(null); setTrying(false) }}><X size={16} /></button>
                </div>
                <div className="screen-editor-body">
                  <input className="input" value={draft.name} maxLength={48} placeholder={uiText('Название, например «Ночь на Таможне»')} onChange={(event) => change({ name: event.target.value })} />
                  <div className="segmented-filter screen-channels">
                    {CHANNELS.map((entry) => <button key={entry.id} type="button" className={channel === entry.id ? 'active' : ''} onClick={() => setChannel(entry.id)}>{uiText(entry.label)}</button>)}
                  </div>
                  <CurveEditor profile={draft} channel={channel} onChange={setCurve} />
                  {SLIDERS.map((slider) => (
                    <label key={slider.key} className="screen-slider">
                      <span>{uiText(slider.label)}<b>{slider.show(draft[slider.key])}</b></span>
                      <input type="range" min={LIMITS[slider.key][0]} max={LIMITS[slider.key][1]} step={slider.step} value={draft[slider.key]} onChange={(event) => change({ [slider.key]: Number(event.target.value) })} />
                    </label>
                  ))}
                  {status?.vibrance !== null && status?.vibrance !== undefined && (
                    <div className="screen-slider">
                      <label className="screen-check"><input type="checkbox" checked={draft.vibrance !== undefined} onChange={(event) => change({ vibrance: event.target.checked ? status.vibrance ?? 50 : undefined })} />{uiText('NVIDIA: цифровая интенсивность')}</label>
                      {draft.vibrance !== undefined && <label><span>{uiText('Насыщенность цвета')}<b>{draft.vibrance}%</b></span><input type="range" min={50} max={100} step={1} value={draft.vibrance} onChange={(event) => change({ vibrance: Number(event.target.value) })} /></label>}
                    </div>
                  )}
                  <div className="screen-editor-actions">
                    <button type="button" className="button" onClick={() => pixels.current && change({ ...autoProfile(pixels.current), curve: draft.curve, channels: draft.channels, vibrance: draft.vibrance })}><Sparkles aria-hidden="true" />{uiText('Подобрать по кадру')}</button>
                    <button type="button" className={`button${trying ? ' primary' : ''}`} disabled={!status?.available} onClick={() => setTrying((value) => !value)}><Eye aria-hidden="true" />{uiText(trying ? 'Убрать с экрана' : 'Попробовать на экране')}</button>
                    <button type="button" className="button primary" onClick={() => void save()}><Save aria-hidden="true" />{uiText('Сохранить пресет')}</button>
                  </div>
                  <p className="screen-hint">{uiText('Кривая: щёлкните, чтобы добавить точку, тяните её, двойной щелчок — убрать. «Попробовать на экране» на пару минут показывает настройку на всех мониторах.')}</p>
                </div>
              </section>
            )}
            {error && <p className="screen-warning is-error"><AlertTriangle aria-hidden="true" />{uiText(error)}</p>}
          </aside>
        </div>
      </>}
    </div>
  )
}
