import { KeyRound, Power, Repeat, ScanSearch, Square } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useBlockTitle } from './blockTitle'
import { sendScreenCommand, useRemoteScreen } from '../screen/screenRemote'

/**
 * «Управление», on the phone's Overview only (owner, 11.11.2026: «блок управления… включать функции на ПК»): the PC's scans
 * and its screen preset, from the phone. «Обнаружение предметов» is the stash scan (Collector, hideout, quests:
 * stashScan/useScreenSync.ts), «Найти ключи» the key search (quests/keyScan.ts) — two buttons, as the owner chose: each looks
 * for its own things, a lighter job for the PC. As small as the other cards of the row (owner: «Сделай его в штатном размере…
 * кнопки сделай меньше… надпись снизу убрать… кнопки вопросиков тоже убери»): a running scan shows as «Остановить».
 * Commands go through the server (src/screen/screenRemote.ts).
 */
export function ControlCard() {
  const title = useBlockTitle('Управление')
  const { pc, online } = useRemoteScreen()
  const state = pc?.state
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
  return (
    <div className="stat-card control-card">
      <div className="control-card-head">
        <div className="stat-label">{title}</div>
        <span className={`control-card-pc${online ? ' is-online' : ''}`}>{uiText(online ? 'ПК' : 'ПК не в сети')}</span>
      </div>
      <div className="control-card-buttons">
        <button type="button" className={`button small control-card-button${scanBusy ? ' is-busy' : ''}`} disabled={!online} aria-pressed={scanBusy}
          onClick={() => sendScreenCommand({ type: 'scan', start: !scanBusy })}>
          {scanBusy ? <Square size={13} aria-hidden="true" /> : <ScanSearch size={13} aria-hidden="true" />}
          <span>{uiText(scanBusy ? 'Остановить' : 'Обнаружение предметов')}</span>
        </button>
        <button type="button" className={`button small control-card-button${keysBusy ? ' is-busy' : ''}`} disabled={!online} aria-pressed={keysBusy}
          onClick={() => sendScreenCommand({ type: 'keys', start: !keysBusy })}>
          {keysBusy ? <Square size={13} aria-hidden="true" /> : <KeyRound size={13} aria-hidden="true" />}
          <span>{uiText(keysBusy ? 'Остановить' : 'Найти ключи')}</span>
        </button>
        <button type="button" className={`button small control-card-button${enabled ? ' is-on' : ''}`} disabled={!online || !presets.length} aria-pressed={enabled}
          onClick={() => sendScreenCommand({ type: 'enabled', enabled: !enabled })}>
          <Power size={13} aria-hidden="true" /><span>{uiText(enabled ? 'Выключить пресет' : 'Включить пресет')}</span>
        </button>
        <button type="button" className="button small control-card-button" disabled={!online || presets.length < 2} onClick={nextPreset}>
          <Repeat size={13} aria-hidden="true" /><span>{uiText('Следующий пресет')}</span>
        </button>
      </div>
    </div>
  )
}
