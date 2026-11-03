import { useCallback, useEffect, useRef, useState } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { collectorEntries } from '../kappa/collector'
import { createScreenSync, screenSyncSummary, type ScreenSyncTargets } from './screenSync'
import { hideoutNeeds } from '../hideout/hideoutNeeds'
import { questNeeds } from '../quests/questItemNeeds'
import { questAvailabilityOf } from '../quests/questReadModel'
import type { AppDataset } from '../domain/types'

/**
 * What a scan looks for in this mode and profile (PvP, PvE and Season apart): the Collector, the hideout's unbuilt levels,
 * the quests still to do (their open pieces) and every item any of them ever asked for (remembered as seen: «Не нужны»).
 */
export function screenSyncTargets(data: AppDataset, state: ReturnType<typeof useAppState>): ScreenSyncTargets {
  const mode = state.raidMode
  const progress = state.activeProfile.modes[mode]
  const kappa = collectorEntries(data.quests, data.items)
  const quests = questNeeds(data.quests, progress, questAvailabilityOf(data.quests, progress), new Map()).items
  const open = new Map(quests.map((need) => [need.itemId, need.uses.filter((use) => !use.done).reduce((sum, use) => sum + use.count, 0)]))
  const known = new Set([
    ...kappa.map(({ item }) => item.id),
    ...hideoutNeeds(data.hideout, {}, new Map()).items.map((need) => need.itemId),
    ...quests.map((need) => need.itemId),
  ])
  return { mode, profileId: state.activeProfile.id, kappa, stations: data.hideout, built: progress.hideoutLevels, items: data.items, quests: open, known }
}

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
    scanning.current = true
    setBusy(true)
    setMessage('')
    setPasses(0)
    try {
      await scanScreen(screenSyncTargets(data, state), {
        button,
        running: () => scanning.current,
        onPass: () => setPasses((count) => count + 1),
        onMessage: setMessage,
        onKappaAdded: (ids) => latest.current.onKappaAdded?.(ids),
      })
    } finally {
      scanning.current = false
      setBusy(false)
    }
  }, [button, stop])

  return { available: Boolean(window.tarkovDesktop), busy, passes, message, run, setMessage }
}

/**
 * One scan: pass after pass for SCAN_WINDOW_MS while `running()` (a second press stops it), each line said through
 * `onMessage`; the last one is returned. The buttons of «Каппа» and «Убежище» and the phone's «Сканировать на ПК»
 * (src/screen/screenRemote.ts) run the same.
 */
export async function scanScreen(targets: ScreenSyncTargets, options: { button: string; running: () => boolean; onPass?: () => void; onMessage: (text: string) => void; onKappaAdded?: (ids: string[]) => void }) {
  const sync = createScreenSync(targets)
  const started = Date.now()
  let kappa = 0, hideout = 0, quests = 0, read = 0
  let sawGame = false
  let last = ''
  const say = (text: string) => { last = text; options.onMessage(text) }
  try {
    for (let pass = 0; options.running() && Date.now() - started < SCAN_WINDOW_MS; pass += 1) {
      const result = await sync.pass(pass === 0)
      if (!result.ok) { say('Сканирование работает только в приложении для Windows.'); return last }
      options.onPass?.()
      if (result.kappaAdded.length) { kappa += result.kappaAdded.length; options.onKappaAdded?.(result.kappaAdded) }
      hideout += result.hideoutAdded
      quests += result.questsAdded
      if (result.gameWindow) sawGame = true
      read += result.read
      say(result.waiting
        ? 'Откройте игру со схроном: сканирование идёт, пока окно игры видно на экране.'
        // How many labels were read tells a scan that sees the stash from one that sees nothing.
        : `Прочитано подписей: ${read} · ${screenSyncSummary(kappa, hideout, quests)}. Листайте схрон — сканирование идёт.`)
      await new Promise((resolve) => setTimeout(resolve, result.waiting ? WAIT_PAUSE_MS : PASS_PAUSE_MS))
    }
    if (options.running()) {
      say(!sawGame
        ? `Окно игры не найдено. Откройте схрон в игре и нажмите «${options.button}» ещё раз.`
        : kappa || hideout || quests ? `Готово. ${screenSyncSummary(kappa, hideout, quests)}` : 'Готово. Новых предметов не найдено.')
    }
  } catch {
    say('Не удалось распознать экран. Попробуйте ещё раз.')
  }
  return last
}
