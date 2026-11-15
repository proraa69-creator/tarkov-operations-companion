import { useEffect, useRef } from 'react'
import { useAppState } from '../state/AppState'
import { clearFoundDocumentsOfProfile, watchRaidEnds } from '../progression/foundDocuments'
import { clearQuestChecksBefore, watchRaidStarts } from '../progression/questChecks'
import { clearTakenItemsBefore } from '../progression/takenItems'

/**
 * Clears the quest checks («Сделал в этом рейде» on the map page) when the next raid starts: the checks made before it
 * go, in every mode of the active profile; the ones made during the raid stay. Desktop shell only — the raid state
 * comes from the EFT logs — and mounted in App, so it works while the map page is closed. The documents ticked «Нашёл» come
 * back on the map when the raid ends (progression/foundDocuments.ts).
 */
export function QuestChecksRaidReset() {
  const { activeProfile } = useAppState()
  const profileRef = useRef(activeProfile.id)
  useEffect(() => { profileRef.current = activeProfile.id })

  useEffect(() => {
    const desktop = window.tarkovDesktop
    if (!desktop?.getRaidState || !desktop.onRaidStateChanged) return
    // «Взял» on the Overview's items (report 157): the marks made before a raid go once that raid is over — a raid really
    // played (watchRaidStarts confirms it), so a cancelled search for a match keeps them.
    let raidStartedAt: number | undefined
    const stopStarts = watchRaidStarts(desktop, (startedAt) => {
      clearQuestChecksBefore(profileRef.current, startedAt)
      raidStartedAt = startedAt
    })
    const stopEnds = watchRaidEnds(desktop, () => {
      clearFoundDocumentsOfProfile(profileRef.current)
      if (raidStartedAt !== undefined) clearTakenItemsBefore(profileRef.current, raidStartedAt)
      raidStartedAt = undefined
    })
    return () => { stopStarts(); stopEnds() }
  }, [])

  return null
}
