import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react'
import { AlertTriangle, Camera, Plus, MonitorCog, Pencil, RotateCcw, Save, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import { SettingHelp } from '../components/SettingHelp'
import type { SettingHelpId } from '../components/settingHelpTexts'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { autoProfile } from './autoTune'
import { BeforeAfter } from './BeforeAfter'
import { CurveEditor, type CurveScale } from './CurveEditor'
import { OptimizePanel } from './OptimizePanel'
import { PresetTriggers } from './PresetTriggers'
import { LIMITS, NEUTRAL, screenTables, type CurvePoint, type ScreenProfile, type Zones } from './screenCurve'
import { screenApi, type ScreenFrame, type ScreenTuningView } from './screenApi'
import { useOwnScreenshot } from './ownScreenshot'
import './screenTuning.css'

type Slider = { key: 'gamma' | 'shadows' | 'highlights' | 'contrast' | 'brightness'; label: string; help: SettingHelpId; step: number; show: (value: number) => string }

const percent = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value * 100)}`
/** The zones of the curve, from black to white (src/screen/screenCurve.ts Zones). */
const ZONES: Array<{ name: keyof Zones; label: string; help: SettingHelpId }> = [
  { name: 'shadows', label: 'Тени (самое тёмное)', help: 'zoneShadows' },
  { name: 'darks', label: 'Тёмные тона', help: 'zoneDarks' },
  { name: 'lights', label: 'Светлые тона', help: 'zoneLights' },
  { name: 'highlights', label: 'Яркие (самое светлое)', help: 'zoneHighlights' },
]

const SLIDERS: Slider[] = [
  { key: 'gamma', label: 'Гамма (средние тона)', help: 'screenGamma', step: 0.01, show: (value) => value.toFixed(2) },
  { key: 'shadows', label: 'Тени', help: 'screenShadows', step: 0.01, show: percent },
  { key: 'highlights', label: 'Светлые участки', help: 'screenHighlights', step: 0.01, show: percent },
  { key: 'contrast', label: 'Контраст', help: 'screenContrast', step: 0.01, show: percent },
  { key: 'brightness', label: 'Яркость', help: 'screenBrightness', step: 0.005, show: percent },
]


/**
 * A slider with its name, its question mark and its value. The mark stands outside <label>: a button inside one would take
 * the label over from the slider.
 */
function TuneSlider({ label, help, shown, ...input }: { label: string; help: SettingHelpId; shown: string | number } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div className="screen-slider">
      <span><span className="screen-slider-name"><label htmlFor={id}>{uiText(label)}</label><SettingHelp id={help} /></span><b>{shown}</b></span>
      <input id={id} type="range" {...input} />
    </div>
  )
}

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

/** «\\.\DISPLAY2» → 2. */
const displayNumber = (name: string) => /(\d+)$/.exec(name)?.[1] ?? name

/** The window for a preset's name: «Сохранить пресет» and renaming (Electron has no prompt()). */
function NameDialog({ title, initial, onCancel, onSave }: { title: string; initial: string; onCancel: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(initial)
  const submit = (event: FormEvent) => { event.preventDefault(); if (name.trim()) onSave(name.trim()) }
  return (
    <div className="screen-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
      <form className="panel screen-dialog" role="dialog" aria-modal="true" aria-label={uiText(title)} onSubmit={submit}>
        <h2>{uiText(title)}</h2>
        <input className="input" autoFocus value={name} maxLength={48} placeholder={uiText('Название, например «Ночь на Таможне»')} onChange={(event) => setName(event.target.value)} />
        <div className="screen-dialog-actions">
          <button type="button" className="button" onClick={onCancel}>{uiText('Отмена')}</button>
          <button type="submit" className="button primary" disabled={!name.trim()}><Save aria-hidden="true" />{uiText('Сохранить')}</button>
        </div>
      </form>
    </div>
  )
}

/**
 * «Настройка экрана» (owner, 27.10.2026): presets and a hand-made curve that go only into the game — the monitor the
 * game is on (or the one picked) while the game is shown; the desktop stays as it is. The game's picture is cut in two:
 * before on the left, after on the right, at its full quality. The curve being edited changes the game at once.
 * «Оптимизация ПК» is the second tab.
 */
export function ScreenTuningPage() {
  const api = screenApi()
  const monitorId = useId()
  const en = useLocale().locale === 'en'
  /** A sentence built from values: both languages here (the dictionary holds only fixed phrases). */
  const say = (ru: string, english: string) => en ? english : ru
  const [tab, setTab] = useState<'screen' | 'pc'>('screen')
  const [view, setView] = useState<ScreenTuningView | null>(null)
  const [frame, setFrame] = useState<ScreenFrame | null>(null)
  const [frameNote, setFrameNote] = useState('')
  const [draft, setDraft] = useState<ScreenProfile | null>(null)
  const [curveScale, setCurveScale] = useState<CurveScale>('shadows')
  const [naming, setNaming] = useState<{ kind: 'save' } | { kind: 'rename'; preset: ScreenProfile } | null>(null)
  const [error, setError] = useState('')
  const pixels = useRef<Uint8ClampedArray | null>(null)

  useEffect(() => {
    if (!api) return
    void api.state().then(setView).catch(() => setError('Не удалось загрузить настройки экрана.'))
    void api.frame('last').then((found) => { if (found) setFrame(found) }).catch(() => {})
    const timer = setInterval(() => { void api.state().then(setView).catch(() => {}) }, 2000)
    return () => { clearInterval(timer); void api.edit(null).catch(() => {}) }
  }, [api])

  const active = view?.presets.find((preset) => preset.id === view.settings.activeId) ?? view?.presets[0] ?? null
  const shown = draft ?? active

  // The curve being edited goes into the game at once (owner, 27.10.2026: «в режиме реального времени в игре»); sent
  // again each minute so it does not run out while the page stays open.
  useEffect(() => {
    if (!api) return
    const send = () => { void api.edit(draft).catch(() => {}) }
    const timer = setTimeout(send, 30)
    const keep = draft ? setInterval(send, 60_000) : undefined
    return () => { clearTimeout(timer); if (keep) clearInterval(keep) }
  }, [api, draft])

  const perform = async (action: () => Promise<unknown>) => {
    setError('')
    try { await action() } catch (problem) { setError(problem instanceof Error ? problem.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Не удалось выполнить действие.') }
  }
  const update = (patch: Parameters<NonNullable<typeof api>['update']>[0]) => perform(async () => { if (api) setView(await api.update(patch)) })

  // «Последний скриншот игры» went (owner, 28.10.2026): a screenshot is pasted (Ctrl+V) or dropped instead.
  const takeFrame = (kind: 'game') => perform(async () => {
    if (!api) return
    const found = await api.frame(kind)
    if (found) { setFrame(found); setFrameNote('') }
    else setFrameNote('Окно игры не видно: откройте игру на экране или вставьте её скриншот (Ctrl+V).')
  })

  const onPixels = useCallback((data: Uint8ClampedArray) => { pixels.current = data }, [])
  const ownFrame = useCallback((found: ScreenFrame) => { setFrame(found); setFrameNote('') }, [])
  const dropping = useOwnScreenshot(tab === 'screen', ownFrame)

  /** Any preset is edited in place, ours too (owner, 28.10.2026); «Вернуть как было» brings ours back. */
  const startEditing = (from: ScreenProfile) => {
    setDraft({ ...from, name: from.builtIn ? uiText(from.name) : from.name, builtIn: undefined, edited: undefined })
  }
  /** «Добавить новый пресет» (owner, 28.10.2026): a new one of the player's, from the chosen preset's settings; as many as wanted. */
  const startNew = () => setDraft({ ...NEUTRAL, ...(active ?? {}), id: '', name: '', note: undefined, builtIn: undefined, edited: undefined })
  const change = (patch: Partial<ScreenProfile>) => setDraft((current) => current ? { ...current, ...patch } : current)
  const setCurve = (points: CurvePoint[]) => setDraft((current) => {
    if (!current) return current
    return { ...current, curve: points }
  })
  const saveDraft = (name: string) => perform(async () => {
    if (!api || !draft) return
    const result = await api.savePreset({ ...draft, name, id: draft.id || 'new' })
    setView(result)
    setNaming(null)
    setDraft(null)
  })
  const rename = (preset: ScreenProfile, name: string) => perform(async () => {
    if (!api) return
    setView(await api.renamePreset(preset.id, name))
    setNaming(null)
  })
  const remove = (preset: ScreenProfile) => perform(async () => {
    if (!api) return
    if (!preset.builtIn && !window.confirm(say(`Удалить пресет «${preset.name}»?`, `Delete the preset «${preset.name}»?`))) return
    setView(await api.deletePreset(preset.id))
  })

  if (!api) {
    return <div className="page"><div className="panel empty-state">{uiText('Настройка экрана работает в приложении Raid OS для Windows.')}</div></div>
  }

  const status = view?.status
  const changedBuiltIns = Object.keys(view?.settings.builtIns ?? {}).length > 0
  const stateLine = !status ? '' : !status.available ? uiText('Windows не даёт менять гамму монитора на этом компьютере.')
    : status.applied ? (() => {
      const name = status.editing ? say('ручная настройка', 'manual tuning') : uiText(active?.name ?? '')
      const strength = Math.round(status.applied.strength * 100)
      return status.applied.strength < 1
        ? say(`В игре сейчас: «${name}», Windows разрешил ${strength}% силы`, `In the game now: «${name}», Windows allowed ${strength}% of it`)
        : say(`В игре сейчас: «${name}»`, `In the game now: «${name}»`)
    })()
    : view?.settings.enabled || draft ? uiText('Включится в рейде, когда окно игры на экране') : uiText('Выключено')

  return (
    <div className="page screen-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{uiText('Настройка экрана')}</h1>
          <p className="page-subtitle">{uiText('Тёмные коридоры и ночные рейды светлее: пресеты и своя кривая. Пресет действует только в рейде, на мониторе с игрой.')}</p>
          {/* what the presets use, in plain words (owner, 08.11.2026) */}
          <p className="page-subtitle screen-legal">{uiText('Используются только цветовая таблица монитора — стандартная функция Windows — и «Цифровая интенсивность» NVIDIA. В игру не встраивается и никак с ней не взаимодействует.')}</p>
        </div>
        <div className="segmented-filter screen-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'screen'} className={tab === 'screen' ? 'active' : ''} onClick={() => setTab('screen')}><MonitorCog aria-hidden="true" />{uiText('Экран')}</button>
          <button type="button" role="tab" aria-selected={tab === 'pc'} className={tab === 'pc' ? 'active' : ''} onClick={() => setTab('pc')}>{uiText('Оптимизировать компьютер')}</button>
        </div>
      </header>

      {tab === 'pc' ? <OptimizePanel /> : <>
        <section className="panel screen-power">
          <span className="setting-help-with">
            <label className="screen-switch">
              <input type="checkbox" checked={Boolean(view?.settings.enabled)} disabled={!view || !status?.available} onChange={(event) => void update({ enabled: event.target.checked })} />
              <span>{uiText('Включить в игре')}</span>
            </label>
            <SettingHelp id="screenEnable" />
          </span>
          <span className="screen-monitor">
            <label htmlFor={monitorId}>{uiText('Монитор')}</label>
            <SettingHelp id="screenMonitor" />
            <select id={monitorId} className="select" value={view?.settings.display ?? ''} disabled={!view} onChange={(event) => void update({ display: event.target.value })}>
              <option value="">{uiText('Тот, где игра')}</option>
              {status?.displays.map((name) => <option key={name} value={name}>{say(`Монитор ${displayNumber(name)}`, `Monitor ${displayNumber(name)}`)}{name === status.gameDisplay ? say(' — сейчас там игра', ' — the game is there now') : ''}</option>)}
            </select>
          </span>
          <span className="screen-state">{stateLine}</span>
          <PresetTriggers view={view} onView={setView} />
        </section>

        <div className="screen-grid">
          <section className={`panel screen-preview${dropping ? ' is-dropping' : ''}`}>
            <div className="panel-header">
              <h2>{draft ? say('Ручная настройка', 'Manual tuning') : say(`Пресет: ${active?.name ?? ''}`, `Preset: ${uiText(active?.name ?? '')}`)}</h2>
              <div className="screen-sources">
                <span className="setting-help-with"><button type="button" className="button small" onClick={() => void takeFrame('game')}><Camera aria-hidden="true" />{uiText('Снимок из игры')}</button><SettingHelp id="screenFrame" /></span>
              </div>
            </div>
            {shown && <BeforeAfter src={frame?.dataUrl ?? null} profile={shown} onPixels={onPixels} />}
            <p className="screen-frame-note">
              {frameNote ? uiText(frameNote) : frame?.source === 'own' ? uiText('Ваш скриншот. Перетащите линию, чтобы сравнить.') : frame ? say(`${frame.source === 'game' ? 'Кадр из игры' : 'Скриншот игры'}, ${ago(frame.at, false)}. Перетащите линию, чтобы сравнить.`, `${frame.source === 'game' ? 'A frame from the game' : 'A game screenshot'}, ${ago(frame.at, true)}. Drag the line to compare.`) : uiText('Когда вы в игре, приложение само берёт кадр раз в полминуты — откройте эту страницу после рейда или нажмите «Снимок из игры».')}
            </p>
            <p className="screen-paste-hint">{uiText('Вставьте свой скриншот: Ctrl+V или перетащите файл картинки в окно — без запуска игры.')}</p>
          </section>

          <aside className="screen-side">
            {!draft ? (
              <section className="panel">
                <div className="panel-header">
                  <h2>{uiText('Пресеты')}<SettingHelp id="screenPresets" /></h2>
                  <span className="setting-help-with"><button type="button" className="button small primary" onClick={startNew}><Plus aria-hidden="true" />{uiText('Добавить новый пресет')}</button><SettingHelp id="screenAddPreset" /></span>
                </div>
                <ul className="screen-presets">
                  {view?.presets.map((preset) => (
                    <li key={preset.id} className={preset.id === view.settings.activeId ? 'is-active' : ''}>
                      <button type="button" className="screen-preset" onClick={() => void update({ activeId: preset.id })}>
                        <CurveThumb profile={preset} />
                        <span><strong>{uiText(preset.name)}</strong><small>{uiText(preset.note ?? (preset.builtIn ? '' : 'Ваш пресет'))}</small></span>
                      </button>
                      <span className="screen-preset-tools">
                        {preset.builtIn && (preset.edited || view.settings.builtIns[preset.id]?.name) && <button type="button" className="icon-button" title={uiText('Вернуть как было')} onClick={() => void perform(async () => { setView(await api.revertPreset(preset.id)) })}><RotateCcw size={15} /></button>}
                        <button type="button" className="icon-button" title={uiText('Настроить кривую')} onClick={() => startEditing(preset)}><SlidersHorizontal size={15} /></button>
                        <button type="button" className="icon-button" title={uiText('Переименовать')} onClick={() => setNaming({ kind: 'rename', preset })}><Pencil size={15} /></button>
                        <button type="button" className="icon-button" title={uiText(preset.builtIn ? 'Убрать из списка' : 'Удалить')} onClick={() => void remove(preset)}><Trash2 size={15} /></button>
                      </span>
                    </li>
                  ))}
                </ul>
                {changedBuiltIns && <span className="setting-help-with screen-restore"><button type="button" className="button small ghost" onClick={() => void perform(async () => { setView(await api.restorePresets()) })}><RotateCcw aria-hidden="true" />{uiText('Вернуть стандартные пресеты')}</button><SettingHelp id="screenRestorePresets" /></span>}
              </section>
            ) : (
              <section className="panel screen-editor">
                <div className="panel-header">
                  <h2>{uiText(draft.id ? 'Ручная настройка' : 'Новый пресет')}<SettingHelp id="screenCurve" /></h2>
                  <button type="button" className="icon-button" title={uiText('Закрыть без сохранения')} onClick={() => setDraft(null)}><X size={16} /></button>
                </div>
                <div className="screen-editor-body">
                  <div className="screen-editor-top">
                    <span className="setting-help-with">
                      <span className="segmented-filter screen-scale" role="group" aria-label={uiText('Шкала кривой')}>
                        <button type="button" className={curveScale === 'shadows' ? 'active' : ''} onClick={() => setCurveScale('shadows')}>{uiText('Тени крупно')}</button>
                        <button type="button" className={curveScale === 'linear' ? 'active' : ''} onClick={() => setCurveScale('linear')}>{uiText('Обычная шкала')}</button>
                      </span>
                      <SettingHelp id="screenScale" />
                    </span>
                    {/* Everything back to a straight line: the curve, the sliders, the zones, the filters and NVIDIA (owner, 27.10.2026). */}
                    <span className="setting-help-with"><button type="button" className="button small ghost" onClick={() => setDraft((current) => current ? { ...current, ...NEUTRAL, channels: undefined, vibrance: undefined, haze: undefined, cast: undefined, zones: undefined } : current)}><RotateCcw aria-hidden="true" />{uiText('Сбросить всё')}</button><SettingHelp id="screenReset" /></span>
                  </div>
                  <CurveEditor profile={draft} channel="all" scale={curveScale} onChange={setCurve} />
                  {/* The zones of the curve, as in Lightroom: each moves one part of the tones and leaves the rest (owner, 28.10.2026). */}
                  <div className="screen-filters">
                    <strong>{uiText('Зоны кривой')}</strong>
                    {ZONES.map((zone) => (
                      <TuneSlider key={zone.name} label={zone.label} help={zone.help} shown={percent(draft.zones?.[zone.name] ?? 0)} min={LIMITS.zone[0]} max={LIMITS.zone[1]} step={0.01} value={draft.zones?.[zone.name] ?? 0} onChange={(event) => change({ zones: { shadows: 0, darks: 0, lights: 0, highlights: 0, ...draft.zones, [zone.name]: Number(event.target.value) } })} />
                    ))}
                  </div>
                  {SLIDERS.map((slider) => (
                    <TuneSlider key={slider.key} label={slider.label} help={slider.help} shown={slider.show(draft[slider.key])} min={LIMITS[slider.key][0]} max={LIMITS[slider.key][1]} step={slider.step} value={draft[slider.key]} onChange={(event) => change({ [slider.key]: Number(event.target.value) })} />
                  ))}
                  {/* Filters (owner, 27.10.2026: «фильтры, которые будут убирать… эффекты»): they work on the screen only. */}
                  <div className="screen-filters">
                    <strong>{uiText('Фильтры')}</strong>
                    <TuneSlider label="Убрать дымку в темноте" help="screenHaze" shown={draft.haze ?? 0} min={LIMITS.haze[0]} max={LIMITS.haze[1]} step={1} value={draft.haze ?? 0} onChange={(event) => change({ haze: Number(event.target.value) || undefined })} />
                    <TuneSlider label="Убрать красно-бурый налёт" help="screenCast" shown={`${Math.round((draft.cast ?? 0) * 100)}%`} min={0} max={1} step={0.05} value={draft.cast ?? 0} onChange={(event) => change({ cast: Number(event.target.value) || undefined })} />
                  </div>
                  {status?.vibrance !== null && status?.vibrance !== undefined && (
                    <div className="screen-slider">
                      <span className="screen-slider-name"><label className="screen-check"><input type="checkbox" checked={draft.vibrance !== undefined} onChange={(event) => change({ vibrance: event.target.checked ? status.vibrance ?? 50 : undefined })} />{uiText('NVIDIA: цифровая интенсивность')}</label><SettingHelp id="screenVibrance" /></span>
                      {draft.vibrance !== undefined && <TuneSlider label="Насыщенность цвета" help="screenSaturation" shown={`${draft.vibrance}%`} min={50} max={100} step={1} value={draft.vibrance} onChange={(event) => change({ vibrance: Number(event.target.value) })} />}
                    </div>
                  )}
                  <div className="screen-editor-actions">
                    <span className="setting-help-with"><button type="button" className="button" onClick={() => pixels.current && change({ channels: undefined, haze: undefined, cast: undefined, zones: undefined, ...autoProfile(pixels.current), vibrance: draft.vibrance })}><Sparkles aria-hidden="true" />{uiText('Подобрать по кадру')}</button><SettingHelp id="screenAuto" /></span>
                    <span className="setting-help-with"><button type="button" className="button primary" onClick={() => setNaming({ kind: 'save' })}><Save aria-hidden="true" />{uiText('Сохранить пресет')}</button><SettingHelp id="screenSave" /></span>
                  </div>
                  <p className="screen-hint">{uiText('Кривая: щёлкните, чтобы добавить точку, тяните её, двойной щелчок — убрать. Выбранную точку можно задать числами или двигать стрелками (Shift — быстрее). Пока вы настраиваете, игра на экране меняется сразу.')}</p>
                </div>
              </section>
            )}
            {error && <p className="screen-warning is-error"><AlertTriangle aria-hidden="true" />{uiText(error)}</p>}
          </aside>
        </div>
      </>}

      {naming?.kind === 'save' && draft && <NameDialog title="Название пресета" initial={draft.name} onCancel={() => setNaming(null)} onSave={(name) => void saveDraft(name)} />}
      {naming?.kind === 'rename' && <NameDialog title="Переименовать пресет" initial={uiText(naming.preset.name)} onCancel={() => setNaming(null)} onSave={(name) => void rename(naming.preset, name)} />}
    </div>
  )
}
