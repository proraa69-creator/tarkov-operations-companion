import { KeyRound, LoaderCircle, Power, Repeat, ScanSearch, Square } from 'lucide-react'
import { SettingHelp } from '../components/SettingHelp'
import { uiText } from '../i18n/renderText'
import { useBlockTitle } from './blockTitle'
import { sendScreenCommand, useRemoteScreen, type RemoteScan } from '../screen/screenRemote'

/** A scan's line from the PC is shown this long after it was said. */
const MESSAGE_MS = 10 * 60_000

/**
 * «Управление», on the phone's Overview only (owner, 11.11.2026: «блок управления… включать функции на ПК»): the PC's scans
 * and its screen preset, from the phone. «Обнаружение предметов» is the stash scan (Collector, hideout, quests:
 * stashScan/useScreenSync.ts), «Найти ключи» the key search (quests/keyScan.ts) — two buttons, as the owner chose: each looks
 * for its own things, a lighter job for the PC. Each «?» says what it finds. Commands go through the server
 * (src/screen/screenRemote.ts); what the PC says comes back the same way.
 */
export function ControlCard() {
  const title = useBlockTitle('Управление')
  const { pc, online, now } = useRemoteScreen()
  const state = pc?.state
  const line = (scan: RemoteScan | undefined) => (scan && now - scan.at < MESSAGE_MS ? scan.message : '')
  const scanBusy = online && state?.scan?.busy === true
  const keysBusy = online && state?.keys?.busy === true
  const enabled = state?.enabled ?? false
  const presets = state?.presets ?? []
  const nextPreset = () => {
    if (!presets.length || !state) return
    const at = presets.findIndex((preset) => preset.id === state.activeId)
    sendScreenCommand({ type: 'select', activeId: presets[(at + 1) % presets.length]!.id })
    if (!enabled) sendScreenCommand({ type: 'enabled', enabled: true })
  }
  const message = keysBusy ? line(state?.keys) : scanBusy ? line(state?.scan) : line(state?.keys) || line(state?.scan)
  return (
    <div className="stat-card control-card">
      <div className="control-card-head">
        <div className="stat-label">{title}</div>
        <span className={`control-card-pc${online ? ' is-online' : ''}`}>{uiText(online ? 'ПК' : 'ПК не в сети')}</span>
      </div>
      <div className="control-card-row">
        <button type="button" className={`button control-card-button${scanBusy ? ' is-busy' : ''}`} disabled={!online} aria-pressed={scanBusy}
          onClick={() => sendScreenCommand({ type: 'scan', start: !scanBusy })}>
          {scanBusy ? <Square size={15} aria-hidden="true" /> : <ScanSearch size={15} aria-hidden="true" />}
          <span>{uiText(scanBusy ? 'Остановить' : 'Обнаружение предметов')}</span>
        </button>
        <SettingHelp id="controlScan" />
      </div>
      <div className="control-card-row">
        <button type="button" className={`button control-card-button${keysBusy ? ' is-busy' : ''}`} disabled={!online} aria-pressed={keysBusy}
          onClick={() => sendScreenCommand({ type: 'keys', start: !keysBusy })}>
          {keysBusy ? <Square size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
          <span>{uiText(keysBusy ? 'Остановить' : 'Найти ключи')}</span>
        </button>
        <SettingHelp id="controlKeys" />
      </div>
      <div className="control-card-presets">
        <button type="button" className={`button control-card-button${enabled ? ' is-on' : ''}`} disabled={!online || !presets.length} aria-pressed={enabled}
          onClick={() => sendScreenCommand({ type: 'enabled', enabled: !enabled })}>
          <Power size={15} aria-hidden="true" /><span>{uiText(enabled ? 'Выключить пресет' : 'Включить пресет')}</span>
        </button>
        <button type="button" className="button control-card-button" disabled={!online || presets.length < 2} onClick={nextPreset}>
          <Repeat size={15} aria-hidden="true" /><span>{uiText('Следующий пресет')}</span>
        </button>
      </div>
      <p className="control-card-line" role="status">
        {(scanBusy || keysBusy) && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
        {!online ? uiText('Откройте Raid OS на ПК с тем же аккаунтом')
          : message ? uiText(message)
            : state?.activeId ? <>{uiText('Пресет')}: {presets.find((preset) => preset.id === state.activeId)?.name ?? ''}</> : null}
      </p>
    </div>
  )
}
