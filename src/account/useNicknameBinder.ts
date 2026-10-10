import { useTarkovData } from '../data/DataProvider'
import type { RaidMode } from '../domain/types'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { useAppState } from '../state/AppState'
import { cleanNickname, findNicknameInModes, RAID_MODE_ORDER, saveNicknameOnServer } from './nicknameBinding'

export interface NicknameBinding {
  /** The profile of the current mode, or of the first mode where the nickname was found. */
  candidate: PlayerProfileCandidate
  /** Modes where the profile was found and bound. */
  modes: RaidMode[]
}

/**
 * «Привязать ник»: one nickname for every mode (owner, 10.10.2026). Finds the profile in PvP, PvE and «Сезон», binds
 * each mode where it exists (its own account id and progress), saves the nickname on the server account and refreshes
 * the data. Modes where the profile is not there yet are bound later by themselves (AccountController).
 */
export function useNicknameBinder() {
  const state = useAppState()
  const { refresh } = useTarkovData()
  return async (raw: string): Promise<NicknameBinding> => {
    const found = await findNicknameInModes(raw, state.raidMode)
    const verifiedAt = new Date().toISOString()
    for (const { mode, candidate } of found) {
      state.registerModeProfile(mode, { accountId: candidate.accountId, enteredNickname: cleanNickname(raw), nickname: candidate.nickname, verifiedAt })
      if (candidate.snapshot) state.updatePlayerSnapshot(mode, candidate.snapshot)
    }
    const main = found.find((entry) => entry.mode === state.raidMode) ?? found[0]
    // A new nickname: a mode still bound to the old one (its profile not found under the new one) is unbound, so it gets
    // the new nickname as soon as its profile appears; its quest progress stays.
    for (const mode of RAID_MODE_ORDER) {
      const registration = state.activeProfile.modes[mode].registration
      if (found.some((entry) => entry.mode === mode) || registration.status !== 'registered') continue
      if ((registration.nickname ?? registration.enteredNickname ?? '').toLowerCase() !== main.candidate.nickname.toLowerCase()) state.clearModeProfile(mode)
    }
    void saveNicknameOnServer(main.candidate.nickname)
    refresh()
    return { candidate: main.candidate, modes: found.map((entry) => entry.mode) }
  }
}
