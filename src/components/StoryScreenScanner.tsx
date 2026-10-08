import { useEffect, useRef } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { confirmStoryFrame, isStoryMenuText, matchStoryChapters, type StoryConfirmation } from '../import/storyScan'
import { isTasksMenuText } from '../import/screenScanSync'
import { matchQuestsFromOcr } from '../import/questOcr'
import type { RaidMode } from '../domain/types'
import { STORY_SCAN_TIMING } from '../import/storyScanTiming'

/** Game open, but not on the story pane: look again every few seconds. */
const MENU_CHECK_MS = STORY_SCAN_TIMING.menuMs
/** Story pane open: follow stage changes closely. */
const STORY_PANE_MS = STORY_SCAN_TIMING.storyMs
/** Game closed or in a raid. */
const IDLE_MS = STORY_SCAN_TIMING.idleMs

/**
 * Background reader for story chapters — the game does not log them. Runs only outside raids,
 * only while the game window is open, and only applies frames that show the story pane.
 */
export function StoryScreenScanner() {
  const { data } = useTarkovData()
  const state = useAppState()
  const questsRef = useRef(data.quests)
  const modeRef = useRef<RaidMode>(state.raidMode)
  const profileRef = useRef(state.activeProfile.id)
  const applyRef = useRef(state.applyStoryScanForMode)
  const applyQuestsRef = useRef(state.applyQuestScanForMode)

  useEffect(() => {
    questsRef.current = data.quests
    modeRef.current = state.raidMode
    profileRef.current = state.activeProfile.id
    applyRef.current = state.applyStoryScanForMode
    applyQuestsRef.current = state.applyQuestScanForMode
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
      while (!cancelled) {
        let delay: number = IDLE_MS
        if (!inRaid) {
          try {
            const mode = modeRef.current
            const context = `${profileRef.current}:${mode}`
            if (context !== lastContext) {
              previous = new Set(); confirmation = null
              contextStartedAt = Date.now(); lastContext = context
            }
            // Capture failure must not skip the independent screenshot fallback.
            // The first observation must retain small objective text too: a menu-quality probe
            // would require a third OCR pass before an exact stage can be confirmed.
            let frame = await desktop.captureQuestFrame(true, true).catch(() => null)
            let matches = frame?.gameWindow ? matchStoryChapters(frame.text, questsRef.current, frame.story) : []
            if (!matches.some((match) => match.stageIndex != null) && desktop.captureQuestScreenshot) {
              const screenshot = await desktop.captureQuestScreenshot(contextStartedAt)
              const fresh = screenshot && Date.now() - screenshot.observedAt <= STORY_SCAN_TIMING.screenshotMaxAgeMs
              const snapshotMatches = fresh ? matchStoryChapters(screenshot.text, questsRef.current, screenshot.story) : []
              if (snapshotMatches.some((match) => match.stageIndex != null)) { frame = screenshot; matches = snapshotMatches }
            }
            if (cancelled) return
            if (context !== `${profileRef.current}:${modeRef.current}` || (detectedMode() && detectedMode() !== mode)) {
              previous = new Set()
              confirmation = null
              await wait(IDLE_MS)
              continue
            }
            if (frame?.gameWindow) delay = MENU_CHECK_MS
            // Story pane parts: the main process already recognised the pane (its tabs are not in those parts).
            if (frame?.gameWindow && !inRaid && (frame.story || isStoryMenuText(frame.text))) {
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
            } else if (frame?.gameWindow && !inRaid && isTasksMenuText(frame.text)) {
              confirmation = null
              delay = STORY_PANE_MS
              const matches = matchQuestsFromOcr(frame.text, questsRef.current).filter((match) => questsRef.current.find((quest) => quest.id === match.questId)?.kind !== 'story')
              const currentIds = matches.map((match) => match.questId)
              if (matches.length) applyQuestsRef.current(mode, matches, questsRef.current, [...previous])
              previous = new Set(currentIds)
            } else {
              previous = new Set()
              confirmation = null
            }
          } catch {
            previous = new Set()
            confirmation = null
          }
        } else {
          previous = new Set(); confirmation = null
        }
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

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
