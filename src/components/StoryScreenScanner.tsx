import { useEffect, useRef } from 'react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { isStoryMenuText, matchStoryChapters } from '../import/storyScan'
import { isTasksMenuText } from '../import/screenScanSync'
import { matchQuestsFromOcr } from '../import/questOcr'
import type { RaidMode } from '../domain/types'

/** Game open, but not on the story pane: look again every few seconds. */
const MENU_CHECK_MS = 4000
/** Story pane open: follow stage changes closely. */
const STORY_PANE_MS = 1500
/** Game closed or in a raid. */
const IDLE_MS = 5000

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
      let onStoryPane = false
      let lastContext = ''
      while (!cancelled) {
        let delay = IDLE_MS
        if (!inRaid) {
          try {
            const mode = modeRef.current
            const context = `${profileRef.current}:${mode}`
            if (context !== lastContext) { previous = new Set(); lastContext = context }
            const frame = await desktop.captureQuestFrame(true, onStoryPane)
            if (cancelled) return
            if (context !== `${profileRef.current}:${modeRef.current}` || (detectedMode() && detectedMode() !== mode)) {
              previous = new Set()
              await wait(IDLE_MS)
              continue
            }
            if (frame.gameWindow) delay = MENU_CHECK_MS
            if (frame.gameWindow && !inRaid && isStoryMenuText(frame.text)) {
              delay = STORY_PANE_MS
              const matches = matchStoryChapters(frame.text, questsRef.current)
              // A chapter must be read on two frames in a row before it counts.
              const confirmed = matches.filter((match) => previous.has(match.questId))
              previous = new Set(matches.map((match) => match.questId))
              if (confirmed.length) applyRef.current(mode, confirmed)
            } else if (frame.gameWindow && !inRaid && isTasksMenuText(frame.text)) {
              delay = STORY_PANE_MS
              const matches = matchQuestsFromOcr(frame.text, questsRef.current).filter((match) => questsRef.current.find((quest) => quest.id === match.questId)?.kind !== 'story')
              const currentIds = matches.map((match) => match.questId)
              if (matches.length) applyQuestsRef.current(mode, matches, questsRef.current, [...previous])
              previous = new Set(currentIds)
            } else {
              previous = new Set()
            }
          } catch {
            previous = new Set()
          }
        }
        onStoryPane = delay === STORY_PANE_MS
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
