import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState'
import { clearQuestChecksBefore, watchRaidStarts } from '../progression/questChecks'

/**
 * Clears the quest checks («Сделал в этом рейде» on the map page) when the next raid starts: the checks made before it
 * go, in every mode of the active profile; the ones made during the raid stay. Desktop shell only — the raid state
 * comes from the EFT logs — and mounted in App, so it works while the map page is closed.
 */
export function QuestChecksRaidReset() {
  const { activeProfile } = useAppState()
  const profileRef = useRef(activeProfile.id)
  useEffect(() => { profileRef.current = activeProfile.id })

  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.getRaidState || !desktop.onRaidStateChanged) return
    return watchRaidStarts(desktop, (startedAt) => { clearQuestChecksBefore(profileRef.current, startedAt) })
  }, [])

  return null
}
