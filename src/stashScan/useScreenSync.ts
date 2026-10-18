import { useCallback, useEffect, useRef, useState } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { collectorEntries } from '../kappa/collector'
import { createScreenSync, screenSyncSummary } from './screenSync'

/** One press scans for this long, so a whole stash can be scrolled through. */
const SCAN_WINDOW_MS = 45_000
/** Rest between passes, so the game keeps the processor (a pass reads only labels new on screen: electron/collectorScan.ts). */
const PASS_PAUSE_MS = 600
const WAIT_PAUSE_MS = 1000

/**
 * The screen sync button of «Каппа» and «Убежище» (src/stashScan/screenSync.ts): pass after pass while the player scrolls
 * the stash, a second press stops it. `button`: the button's name in the «window not found» message.
 * Windows app only: `available` is false on the phone and the website.
 */
export function useScreenSync(button: string, onKappaAdded?: (ids: string[]) => void) {
  const { data } = useTarkovData()
  const state = useAppState()
  const [busy, setBusy] = useState(false)
  const [passes, setPasses] = useState(0)
  const [message, setMessage] = useState('')
  const scanning = useRef(false)
  const latest = useRef({ data, state, onKappaAdded })
  useEffect(() => { latest.current = { data, state, onKappaAdded } })
  const stop = useCallback(() => { scanning.current = false }, [])
  useEffect(() => stop, [stop])

  const run = useCallback(async () => {
    if (scanning.current) { stop(); return }
    const { data, state } = latest.current
    const mode = state.raidMode
    const sync = createScreenSync({
      mode,
      profileId: state.activeProfile.id,
      kappa: collectorEntries(data.quests, data.items),
      stations: data.hideout,
      built: state.activeProfile.modes[mode].hideoutLevels,
      items: data.items,
    })
    scanning.current = true
    setBusy(true)
    setMessage('')
    setPasses(0)
    const started = Date.now()
    let kappa = 0, hideout = 0, read = 0
    let sawGame = false
    try {
      for (let pass = 0; scanning.current && Date.now() - started < SCAN_WINDOW_MS; pass += 1) {
        const result = await sync.pass(pass === 0)
        if (!result.ok) { setMessage('Сканирование работает только в приложении для Windows.'); break }
        setPasses((count) => count + 1)
        if (result.kappaAdded.length) { kappa += result.kappaAdded.length; latest.current.onKappaAdded?.(result.kappaAdded) }
        hideout += result.hideoutAdded
        if (result.gameWindow) sawGame = true
        read += result.read
        setMessage(result.waiting
          ? 'Откройте игру со схроном: сканирование идёт, пока окно игры видно на экране.'
          // How many labels were read tells a scan that sees the stash from one that sees nothing.
          : `Прочитано подписей: ${read} · ${screenSyncSummary(kappa, hideout)}. Листайте схрон — сканирование идёт.`)
        await new Promise((resolve) => setTimeout(resolve, result.waiting ? WAIT_PAUSE_MS : PASS_PAUSE_MS))
      }
      if (scanning.current) {
        setMessage(!sawGame
          ? `Окно игры не найдено. Откройте схрон в игре и нажмите «${button}» ещё раз.`
          : kappa || hideout ? `Готово. ${screenSyncSummary(kappa, hideout)}` : 'Готово. Новых предметов не найдено.')
      }
    } catch {
      setMessage('Не удалось распознать экран. Попробуйте ещё раз.')
    } finally {
      scanning.current = false
      setBusy(false)
    }
  }, [button, stop])

  return { available: Boolean(window.tarkovDesktop), busy, passes, message, run, setMessage }
}
