import { LoaderCircle, ScanSearch, Square } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { sendScreenCommand, useRemoteScreen } from '../screen/screenRemote'

/** The PC's scan line is shown this long after it was said. */
const MESSAGE_MS = 10 * 60_000

/**
 * «Сканировать на ПК» on the phone (owner, 31.10.2026: «сканирование экрана для предметов нажимается в телефоне и скан
 * запускается, все обнаруженные предметы добавляются, для каппы, для убежища и квестов»): starts the PC's «Синхронизация по
 * экрану» (src/screen/screenRemote.ts → stashScan/useScreenSync.ts scanScreen) and shows its lines; what it finds reaches
 * the phone with the account's lists (Kappa, hideout, quests).
 */
export function RemoteScanButton() {
  const { pc, online, now } = useRemoteScreen()
  const scan = pc?.state.scan
  const busy = online && scan?.busy === true
  const message = scan && now - scan.at < MESSAGE_MS ? scan.message : ''
  return <div className="remote-scan">
    <button type="button" className="button primary" disabled={!online} onClick={() => sendScreenCommand({ type: 'scan', start: !busy })}
      title={uiText('Откройте схрон в игре на ПК и листайте его: найденные предметы отметятся в «Каппе», убежище и квестах.')}>
      {busy ? <Square size={14} aria-hidden="true" /> : <ScanSearch size={14} aria-hidden="true" />}{uiText(busy ? 'Остановить скан на ПК' : 'Сканировать на ПК')}
    </button>
    <p className="remote-scan-message" role="status">
      {busy && <LoaderCircle size={13} className="spin" aria-hidden="true" />}
      {uiText(!online ? 'ПК не в сети — откройте Raid OS на ПК' : message || 'Откройте схрон в игре на ПК и нажмите кнопку')}
    </p>
  </div>
}
