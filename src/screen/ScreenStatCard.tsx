import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Monitor, Repeat, Settings } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useBlockTitle } from '../overview/blockTitle'
import { screenLiveRequest } from '../sync/serverSync'
import { screenApi } from './screenApi'
import { PC_ONLINE_MS, type RemoteScreenState, type ScreenCommand } from './screenRemote'

/** What the card shows and does, the same on the PC (its own presets) and on the phone (the PC's, through the server). */
interface ScreenControl {
  /** Null: nothing known yet (no PC on the phone, or the PC's screen settings unavailable). */
  presetName: string | null
  enabled: boolean
  /** The phone: the PC is on line; the PC: always. */
  online: boolean
  toggle: () => void
  next: () => void
}

const POLL_MS = 2_000
const RETRY_MS = 3_000

/** The PC: «Настройка экрана» of this computer, read every two seconds (the hotkey changes it too). */
function usePcScreen(): ScreenControl | null {
  const api = screenApi()
  const [view, setView] = useState<{ name: string | null; enabled: boolean; ids: string[]; activeId: string } | null>(null)
  useEffect(() => {
    if (!api) return
    let alive = true
    const read = () => void api.state().then((state) => {
      if (!alive) return
      const active = state.presets.find((preset) => preset.id === state.settings.activeId)
      setView({ name: active?.name ?? null, enabled: state.settings.enabled, ids: state.presets.map((preset) => preset.id), activeId: state.settings.activeId })
    }).catch(() => {})
    read()
    const timer = window.setInterval(read, POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [api])
  if (!api) return null
  const apply = (patch: Parameters<typeof api.update>[0]) => void api.update(patch).then((state) => {
    const active = state.presets.find((preset) => preset.id === state.settings.activeId)
    setView({ name: active?.name ?? null, enabled: state.settings.enabled, ids: state.presets.map((preset) => preset.id), activeId: state.settings.activeId })
  }).catch(() => {})
  return {
    presetName: view?.name ?? null,
    enabled: view?.enabled ?? false,
    online: true,
    toggle: () => apply({ enabled: !(view?.enabled ?? false) }),
    next: () => {
      if (!view?.ids.length) return
      const at = view.ids.indexOf(view.activeId)
      apply({ activeId: view.ids[(at + 1) % view.ids.length]!, enabled: true })
    },
  }
}

/** The phone: the PC's presets through the server (src/screen/screenRemote.ts), the phone's taps sent at once. */
function useRemoteScreen(on: boolean): ScreenControl {
  const [pc, setPc] = useState<{ state: RemoteScreenState; at: number } | null>(null)
  const [local, setLocal] = useState<{ enabled?: boolean; activeId?: string }>({})
  const [now, setNow] = useState(0)
  const localRef = useRef(local)
  useEffect(() => { localRef.current = local })
  useEffect(() => {
    if (!on) return
    let alive = true
    void (async () => {
      let since: number | undefined
      while (alive) {
        const answer = await screenLiveRequest<{ version?: unknown; pc?: { state?: RemoteScreenState; at?: number } | null }>('GET', `/v1/live/screen${since === undefined ? '' : `?since=${since}`}`).catch(() => null)
        if (!alive) break
        const version = Number(answer?.version)
        if (!answer || !Number.isSafeInteger(version)) { await new Promise((resolve) => setTimeout(resolve, RETRY_MS)); continue }
        since = version
        const next = answer.pc?.state && typeof answer.pc.at === 'number' ? { state: answer.pc.state, at: answer.pc.at } : null
        setPc(next)
        setNow(Date.now())
        // the PC's word replaces the phone's own tap once it says the same
        if (next) setLocal((value) => ({
          ...(value.enabled !== undefined && value.enabled !== next.state.enabled ? { enabled: value.enabled } : {}),
          ...(value.activeId !== undefined && value.activeId !== next.state.activeId ? { activeId: value.activeId } : {}),
        }))
      }
    })()
    const clock = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => { alive = false; window.clearInterval(clock) }
  }, [on])
  const send = (command: ScreenCommand) => { void screenLiveRequest('POST', '/v1/live/screen/command', command).catch(() => null) }
  const state = pc?.state
  const activeId = local.activeId ?? state?.activeId ?? ''
  const enabled = local.enabled ?? state?.enabled ?? false
  const presets = state?.presets ?? []
  return {
    presetName: presets.find((preset) => preset.id === activeId)?.name ?? null,
    enabled,
    online: pc !== null && now - pc.at < PC_ONLINE_MS,
    toggle: () => { setLocal((value) => ({ ...value, enabled: !enabled })); send({ type: 'enabled', enabled: !enabled }) },
    next: () => {
      if (!presets.length) return
      const at = presets.findIndex((preset) => preset.id === activeId)
      const id = presets[(at + 1) % presets.length]!.id
      setLocal({ activeId: id, enabled: true })
      send({ type: 'select', activeId: id })
      if (!enabled) send({ type: 'enabled', enabled: true })
    },
  }
}

/**
 * «Экран» on the Overview (owner, 11.11.2026: «первые два блока верхние, маленькие, это экран и кочевники… включение-выключение
 * пресетов. И при нажатии настройки тебя переносит прямо в окно пресеты экрана»): the chosen preset, on / off, the next one,
 * and the square gear that opens «Пресеты экрана» (the phone) or «Настройка экрана» (the PC) as a page.
 */
export function ScreenStatCard() {
  const navigate = useNavigate()
  // the owner's heading of the block (Админ панель → «Блоки»), else «Экран»
  const title = useBlockTitle('Экран')
  const pcControl = usePcScreen()
  const remote = useRemoteScreen(!pcControl)
  const control = pcControl ?? remote
  const known = control.presetName !== null
  return (
    <div className={`stat-card screen-stat-card${control.enabled ? ' is-on' : ''}`}>
      <div className="screen-stat-head">
        <div className="stat-label"><Monitor size={12} aria-hidden="true" /> {title}</div>
        {!pcControl && <span className={`screen-stat-pc${control.online ? ' is-online' : ''}`}>{uiText(control.online ? 'ПК' : 'ПК не в сети')}</span>}
      </div>
      <div className="screen-stat-row">
        <div className="screen-stat-name" title={control.presetName ?? undefined}>{known ? control.presetName : uiText('Нет связи с ПК')}</div>
        <button type="button" role="switch" aria-checked={control.enabled} className={`screen-stat-toggle${control.enabled ? ' is-on' : ''}`} disabled={!known} onClick={control.toggle}
          aria-label={uiText(control.enabled ? 'Выключить пресет' : 'Включить пресет')} title={uiText(control.enabled ? 'Выключить пресет' : 'Включить пресет')}>
          <span aria-hidden="true" />
        </button>
      </div>
      {known && <div className="screen-stat-state">{uiText(control.enabled ? 'Включён' : 'Выключен')}</div>}
      <div className="screen-stat-actions">
        <button type="button" className="button small screen-stat-next" disabled={!known} onClick={control.next}><Repeat size={13} aria-hidden="true" />{uiText('Переключить')}</button>
        <button type="button" className="icon-button screen-stat-settings" onClick={() => navigate('/screen')} aria-label={uiText('Настройка экрана')} title={uiText('Настройка экрана')}><Settings size={15} aria-hidden="true" /></button>
      </div>
    </div>
  )
}
