import { useEffect, useRef } from 'react'
import { keepModeSelectScreen, keepTraderScreen } from '../account/logNickname'
import { useLogStatus } from '../import/logStatus'
import { logsGameMode } from '../import/screenReadingMode'
import { STORY_SCAN_TIMING } from '../import/storyScanTiming'

/**
 * The locked app's reader of the player's identity — on the sign-in and subscription screens (audit P4a; #202
 * «персонаж должен находиться сразу при первом запуске»). A game started before the sign-in shows «Выбор профиля и
 * режима» only then, and the app was not reading anything yet. This reader looks at the game only right after a new game
 * window (the main process copies nothing at any other time: electron/screenOcr.ts captureIdentityFrame), reads the mode
 * selection and the traders' screens only — no quest, no story chapter — and keeps what it reads in the nickname and
 * level store (src/account/logNickname.ts), which applies it when the app unlocks (StoryScreenScanner). Never in a raid.
 */
export function IdentityScreenReader() {
  const logStatus = useLogStatus()
  const logStatusRef = useRef(logStatus)
  useEffect(() => { logStatusRef.current = logStatus })

  useEffect(() => {
    const desktop = window.tarkovDesktop
    const capture = desktop?.captureIdentityFrame
    if (!desktop || !capture) return
    let cancelled = false
    let inRaid = false
    let wake: (() => void) | null = null
    const unsubscribe = desktop.onRaidStateChanged((next) => {
      const ended = inRaid && !next.inRaid
      inRaid = next.inRaid
      if (ended) wake?.()
    })
    /** One look: the quick pace of a game start, else just whether a new game window came (nothing copied). */
    const look = async (): Promise<number> => {
      const frame = await capture().catch(() => null)
      if (cancelled || !frame?.gameWindow) return STORY_SCAN_TIMING.idleMs
      if (frame.raid) return STORY_SCAN_TIMING.raidMs
      if (frame.busy) return STORY_SCAN_TIMING.busyMs
      const at = frame.observedAt ?? Date.now()
      if (frame.profiles?.length) keepModeSelectScreen(frame.profiles, at)
      if (frame.trader) keepTraderScreen(frame.trader, logsGameMode(logStatusRef.current), at)
      return frame.freshGame ? STORY_SCAN_TIMING.menuMs : STORY_SCAN_TIMING.idleMs
    }
    const loop = async () => {
      while (!cancelled) {
        const delay = inRaid ? STORY_SCAN_TIMING.idleMs : await look().catch(() => STORY_SCAN_TIMING.idleMs)
        if (cancelled) return
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(done, delay)
          function done() { window.clearTimeout(timer); wake = null; resolve() }
          wake = done
        })
      }
    }
    // The first look waits for the raid state the logs report.
    void desktop.getRaidState().then((next) => { inRaid = next.inRaid }).catch(() => {}).finally(() => { if (!cancelled) void loop() })
    return () => {
      cancelled = true
      unsubscribe()
      wake?.()
    }
  }, [])

  return null
}
