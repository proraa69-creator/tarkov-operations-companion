import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, MonitorOff, Power } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { screenLiveRequest } from '../sync/serverSync'
import type { ScreenProfile } from './screenCurve'
import { LIMITS } from './screenCurve'
import { PC_ONLINE_MS, remotePreset, type RemoteScreenState, type ScreenCommand } from './screenRemote'
import './mobileScreenPresets.css'

/** The sliders of the phone: the main settings of «Настройка экрана»; the curve is tuned on the PC. */
const SLIDERS: Array<{ key: 'gamma' | 'shadows' | 'highlights' | 'contrast' | 'brightness' | 'temperature' | 'tint'; label: string; step: number }> = [
  { key: 'gamma', label: 'Гамма', step: 0.01 },
  { key: 'shadows', label: 'Тени', step: 0.005 },
  { key: 'highlights', label: 'Света', step: 0.005 },
  { key: 'contrast', label: 'Контраст', step: 0.01 },
  { key: 'brightness', label: 'Яркость', step: 0.005 },
  { key: 'temperature', label: 'Температура', step: 0.02 },
  { key: 'tint', label: 'Оттенок', step: 0.02 },
]
/** A tuned preset goes to the PC this long after the finger stops (the PC's screen follows while it moves). */
const SEND_AFTER_MS = 150
const RETRY_MS = 3_000

/**
 * «Пресеты экрана» on the phone (owner, 31.10.2026: «добавь функцию пресетов на телефонную версию… моментально меняются
 * настройки пресетов на пк… выбирать пресеты с телефона… включать и выключать их»): the PC's presets (src/screen/
 * screenRemote.ts), chosen, switched on / off and tuned here; every change reaches the PC at once. What the phone
 * shows is what the PC last said, with the phone's own change on top until the PC confirms it.
 */
export function MobileScreenPresets() {
  const [pc, setPc] = useState<{ state: RemoteScreenState; at: number } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [local, setLocal] = useState<Partial<Pick<RemoteScreenState, 'activeId' | 'enabled'>> & { preset?: ScreenProfile }>({})
  const [now, setNow] = useState(() => Date.now())
  const sendTimer = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      let since: number | undefined
      while (active) {
        const answer = await screenLiveRequest<{ version?: unknown; pc?: { state?: RemoteScreenState; at?: number } | null }>('GET', `/v1/live/screen${since === undefined ? '' : `?since=${since}`}`).catch(() => null)
        if (!active) break
        const version = Number(answer?.version)
        if (!answer || !Number.isSafeInteger(version)) { await new Promise((resolve) => setTimeout(resolve, RETRY_MS)); continue }
        since = version
        setLoaded(true)
        const next = answer.pc?.state && typeof answer.pc.at === 'number' ? { state: answer.pc.state, at: answer.pc.at } : null
        setPc(next)
        setNow(Date.now())
        // The PC's word replaces the phone's own change once it says the same.
        if (next) setLocal((value) => ({
          ...(value.activeId !== undefined && value.activeId !== next.state.activeId ? { activeId: value.activeId } : {}),
          ...(value.enabled !== undefined && value.enabled !== next.state.enabled ? { enabled: value.enabled } : {}),
          ...(value.preset && sendTimer.current !== null ? { preset: value.preset } : {}),
        }))
      }
    })()
    // «на связи» is redrawn as time passes.
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => { active = false; window.clearInterval(clock) }
  }, [])

  const send = (command: ScreenCommand) => { void screenLiveRequest('POST', '/v1/live/screen/command', command).catch(() => null) }
  const online = pc !== null && now - pc.at < PC_ONLINE_MS
  const state = pc?.state
  const activeId = local.activeId ?? state?.activeId ?? ''
  const enabled = local.enabled ?? state?.enabled ?? false
  const presets = state?.presets ?? []
  const chosen = local.preset && local.preset.id === activeId ? local.preset : presets.find((preset) => preset.id === activeId)

  const choose = (id: string) => { setLocal((value) => ({ ...value, activeId: id, preset: undefined })); send({ type: 'select', activeId: id }) }
  const toggle = () => { setLocal((value) => ({ ...value, enabled: !enabled })); send({ type: 'enabled', enabled: !enabled }) }
  const tune = (key: (typeof SLIDERS)[number]['key'] | 'vibrance', value: number) => {
    if (!chosen) return
    const preset = { ...chosen, [key]: value }
    setLocal((current) => ({ ...current, preset }))
    if (sendTimer.current !== null) window.clearTimeout(sendTimer.current)
    sendTimer.current = window.setTimeout(() => { sendTimer.current = null; send({ type: 'save', preset: remotePreset(preset) }) }, SEND_AFTER_MS)
  }

  return <div className="page mobile-screen-presets">
    <header className="page-header">
      <div>
        <h1 className="page-title">{uiText('Пресеты экрана')}</h1>
        <p className="page-subtitle">{uiText('Выбирайте и настраивайте пресеты «Настройки экрана» на ПК прямо с телефона — меняется сразу.')}</p>
      </div>
    </header>

    <section className={`panel msp-status${online ? ' is-online' : ''}`}>
      {online ? <Monitor size={18} aria-hidden="true" /> : <MonitorOff size={18} aria-hidden="true" />}
      <div>
        <strong>{uiText(!loaded ? 'Подключаемся…' : online ? 'ПК на связи' : 'ПК не в сети')}</strong>
        <span>{uiText(!loaded ? 'Спрашиваем сервер' : online ? (state?.on ? 'Пресет сейчас на экране' : state?.inRaid ? 'Пресет выключен' : 'Пресет включится в рейде') : 'Откройте Raid OS на ПК с тем же аккаунтом')}</span>
      </div>
    </section>

    {state && <>
      {!state.available && <p className="msp-note">{uiText('На этом ПК нельзя менять гамму монитора — пресеты работают только в Windows.')}</p>}
      <button type="button" className={`panel msp-toggle${enabled ? ' is-on' : ''}`} aria-pressed={enabled} onClick={toggle} disabled={!online}>
        <Power size={20} aria-hidden="true" />
        <span><strong>{uiText(enabled ? 'Пресет включён' : 'Пресет выключен')}</strong><small>{uiText('Работает в рейде, когда игра на экране')}</small></span>
        <span className="msp-switch" aria-hidden="true"><span /></span>
      </button>

      <section className="panel msp-list" aria-label={uiText('Пресеты')}>
        <h3>{uiText('Пресеты')}</h3>
        {presets.map((preset) => <button key={preset.id} type="button" className={`msp-preset${preset.id === activeId ? ' is-active' : ''}`} aria-pressed={preset.id === activeId} onClick={() => choose(preset.id)} disabled={!online}>
          <span><strong>{preset.name}</strong>{preset.note && <small>{preset.note}</small>}</span>
          {preset.id === activeId && <Check size={16} aria-hidden="true" />}
        </button>)}
      </section>

      {chosen && <section className="panel msp-tune" aria-label={uiText('Настройка пресета')}>
        <h3>{uiText('Настройка')} · {chosen.name}</h3>
        {SLIDERS.map(({ key, label, step }) => <label key={key} className="msp-slider">
          <span>{uiText(label)}<b className="mono">{chosen[key].toFixed(2)}</b></span>
          <input type="range" min={LIMITS[key][0]} max={LIMITS[key][1]} step={step} value={chosen[key]} disabled={!online} onChange={(event) => tune(key, Number(event.target.value))} />
        </label>)}
        {chosen.vibrance !== undefined && <label className="msp-slider">
          <span>{uiText('Цифровая интенсивность')}<b className="mono">{Math.round(chosen.vibrance)}%</b></span>
          <input type="range" min={LIMITS.vibrance[0]} max={LIMITS.vibrance[1]} step={1} value={chosen.vibrance} disabled={!online} onChange={(event) => tune('vibrance', Number(event.target.value))} />
        </label>}
        <p className="msp-note">{uiText('Кривую и фильтры настраивайте на ПК в «Настройке экрана».')}</p>
      </section>}
    </>}
  </div>
}
