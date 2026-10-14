import { useEffect, useRef } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { confirmStoryFrame, isStoryMenuText, matchStoryChapters, type StoryConfirmation } from '../import/storyScan'
import { isTasksMenuText } from '../import/screenScanSync'
import { matchQuestsFromOcr } from '../import/questOcr'
import type { RaidMode } from '../domain/types'
import { gameScanDelay, STORY_SCAN_TIMING } from '../import/storyScanTiming'
import { applyModeSelectScreen, applyTraderScreen } from '../account/logNickname'
import { useLogStatus } from '../import/logStatus'
import { useLogsCoverModes } from '../import/logCoverage'

/** Story pane open: follow stage changes closely. */
const STORY_PANE_MS = STORY_SCAN_TIMING.storyMs
/** Game closed or in a raid. */
const IDLE_MS = STORY_SCAN_TIMING.idleMs

/**
 * Background reader for story chapters — the game does not log them — and for the game's «Выбор профиля и режима»
 * screen (nickname and every mode's level). Runs only outside raids, only while the game window is open, and only
 * applies frames that show those screens.
 */
export function StoryScreenScanner() {
  const { data } = useTarkovData()
  const state = useAppState()
  // Per mode: the game's logs hold its whole quest history (src/import/logCoverage.ts).
  const logsCover = useLogsCoverModes(useLogStatus().scan, data.quests)
  const logsCoverRef = useRef(logsCover)
  const questsRef = useRef(data.quests)
  const modeRef = useRef<RaidMode>(state.raidMode)
  const profileRef = useRef(state.activeProfile.id)
  const applyRef = useRef(state.applyStoryScanForMode)
  const applyQuestsRef = useRef(state.applyQuestScanForMode)
  // The game's «Выбор профиля и режима» screen: nickname and levels of every mode (account/logNickname.ts).
  const stateRef = useRef(state)

  useEffect(() => {
    questsRef.current = data.quests
    logsCoverRef.current = logsCover
    modeRef.current = state.raidMode
    profileRef.current = state.activeProfile.id
    applyRef.current = state.applyStoryScanForMode
    applyQuestsRef.current = state.applyQuestScanForMode
    stateRef.current = state
  })

  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop) return
    let cancelled = false
    let inRaid = false
    let wakeUp: (() => void) | null = null
    // Back from a raid: look at once. While the window sits minimized behind the game its timers are throttled,
    // and a long in-raid wait could otherwise end up to a minute late.
    const unsubscribe = desktop.onRaidStateChanged((next) => {
      const ended = inRaid && !next.inRaid
      inRaid = next.inRaid
      if (ended) wakeUp?.()
    })
    void desktop.getRaidState().then((next) => { inRaid = next.inRaid }).catch(() => {})

    const loop = async () => {
      let previous = new Set<string>()
      let confirmation: StoryConfirmation | null = null
      let lastContext = ''
      let contextStartedAt = Date.now()
      /** Looks in a row at the game showing no screen read here (quietScanDelay). */
      let quiet = 0
      const forget = () => { previous = new Set(); confirmation = null }
      /** One look at the game (outside a raid the logs report); returns the pause before the next one. */
      const look = async (): Promise<number> => {
        const mode = modeRef.current
        const context = `${profileRef.current}:${mode}`
        if (context !== lastContext) {
          forget()
          contextStartedAt = Date.now(); lastContext = context
        }
        // Capture failure must not skip the independent screenshot fallback.
        // The first observation must retain small objective text too: a menu-quality probe
        // would require a third OCR pass before an exact stage can be confirmed.
        let frame = await desktop.captureQuestFrame(true, true).catch(() => null)
        // A raid the logs do not report (the minimap, its key, a screenshot with coordinates, movement): the main process
        // copied nothing (electron/experimental/raidSignals.ts). Asked again in a few seconds, for the price of a message.
        if (frame?.raid) { forget(); return STORY_SCAN_TIMING.raidMs }
        // An item lookup or a Kappa scan runs: the player waits for those, so the scanner yields (electron/ocrQueue.ts).
        if (frame?.busy) return STORY_SCAN_TIMING.busyMs
        // Shown on every game start, for all modes at once: applied right away, whatever mode the app shows.
        if (frame?.gameWindow && frame.profiles?.length) applyModeSelectScreen(frame.profiles, frame.observedAt ?? Date.now(), () => stateRef.current)
        // The traders' screen: the level of the mode the game is in (from the logs) and the nickname marked «(вы)».
        if (frame?.gameWindow && frame.trader) applyTraderScreen(frame.trader, detectedMode(), frame.observedAt ?? Date.now(), () => stateRef.current)
        let matches = frame?.gameWindow ? matchStoryChapters(frame.text, questsRef.current, frame.story) : []
        if (!matches.some((match) => match.stageIndex != null) && desktop.captureQuestScreenshot) {
          const screenshot = await desktop.captureQuestScreenshot(contextStartedAt)
          const fresh = screenshot && Date.now() - screenshot.observedAt <= STORY_SCAN_TIMING.screenshotMaxAgeMs
          const snapshotMatches = fresh ? matchStoryChapters(screenshot.text, questsRef.current, screenshot.story) : []
          if (snapshotMatches.some((match) => match.stageIndex != null)) { frame = screenshot; matches = snapshotMatches }
        }
        if (cancelled) return IDLE_MS
        if (context !== `${profileRef.current}:${modeRef.current}` || (detectedMode() && detectedMode() !== mode)) {
          forget()
          return IDLE_MS
        }
        // Owner, 14.10.2026: «если логи всех квестов обнаружены, что бы приложение перестало сканировать квесты через экран».
        // This mode's logs hold its whole quest history (src/import/logCoverage.ts): they are the truth about its trader
        // quests, so the Tasks table is passed over — not read, not applied — and looked at only at the slow pace. Story
        // chapters (the game never logs them), «Выбор профиля и режима» and the traders' screen are read as before; once
        // the logs show a gap (a quest handed in without its acceptance), the table is read again.
        const storyScreen = Boolean(frame?.gameWindow && (frame.story || isStoryMenuText(frame.text)))
        const tasksTable = Boolean(frame?.gameWindow && !storyScreen && isTasksMenuText(frame.text))
        const tasksFromLogs = tasksTable && logsCoverRef.current[mode]
        let delay: number = IDLE_MS
        if (frame?.gameWindow) {
          const known = Boolean(frame.story || frame.profiles?.length || frame.trader || storyScreen || (tasksTable && !tasksFromLogs))
          quiet = known ? 0 : quiet + 1
          // The quick pace only right after a new game window (the mode selection), never after a raid or an Alt+Tab.
          delay = gameScanDelay(known ? 'known' : tasksFromLogs ? 'ignored' : 'unknown', quiet, frame.freshGame === true)
        } else quiet = 0
        // Story pane parts: the main process already recognised the pane (its tabs are not in those parts).
        if (frame?.gameWindow && !inRaid && storyScreen) {
          delay = STORY_PANE_MS
          const screenshot = frame.sourceName === 'EFT screenshot'
          const checked = confirmStoryFrame(screenshot ? null : confirmation, context, frame.observedAt ?? 0, matches)
          confirmation = screenshot ? null : checked.state
          previous = new Set(matches.map((match) => match.questId))
          // One screenshot is one observation, even if the same file is read twice.
          // Exact evidence can correct an old stage, but cannot authorize an unproven forward step.
          if (screenshot) applyRef.current(mode, matches.filter(match => match.stageIndex != null || (match.active && match.objectives?.length)))
          else {
            // Publish visible tasks on the first exact reading; sequence advancement still needs confirmation.
            applyRef.current(mode, matches.filter(match => match.objectives?.length))
            if (checked.confirmed.length) applyRef.current(mode, checked.confirmed)
          }
        } else if (frame?.gameWindow && !inRaid && tasksTable && !tasksFromLogs) {
          confirmation = null
          delay = STORY_PANE_MS
          const matches = matchQuestsFromOcr(frame.text, questsRef.current).filter((match) => questsRef.current.find((quest) => quest.id === match.questId)?.kind !== 'story')
          const currentIds = matches.map((match) => match.questId)
          if (matches.length) applyQuestsRef.current(mode, matches, questsRef.current, [...previous])
          previous = new Set(currentIds)
        } else forget()
        return delay
      }
      while (!cancelled) {
        let delay: number = IDLE_MS
        if (!inRaid) {
          try {
            delay = await look()
          } catch {
            forget()
          }
        } else forget()
        if (cancelled) return
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(done, delay)
          function done() { window.clearTimeout(timer); wakeUp = null; resolve() }
          wakeUp = done
        })
      }
    }
    void loop()
    return () => {
      cancelled = true
      unsubscribe()
      wakeUp?.()
    }
  }, [])

  return null
}

function detectedMode(): RaidMode | undefined {
  const value = sessionStorage.getItem('eft-last-detected-mode')
  return value === 'pvp' || value === 'pve' || value === 'seasonal' ? value : undefined
}

