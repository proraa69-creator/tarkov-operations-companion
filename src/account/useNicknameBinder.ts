import { useTarkovData } from '../data/DataProvider'
import type { RaidMode } from '../domain/types'
import type { PlayerProfileCandidate } from '../profile/playerProfileGateway'
import { useAppState } from '../state/AppState'
import { cleanNickname, findNickname, saveNicknamesOnServer } from './nicknameBinding'

/**
 * «Привязать ник»: finds the profile, binds it to the mode locally, saves it on the server account and refreshes the
 * data. One step, as the owner described it: type the nickname, press the button, done.
 */
export function useNicknameBinder() {
  const state = useAppState()
  const { refresh } = useTarkovData()
  return async (mode: RaidMode, raw: string): Promise<PlayerProfileCandidate> => {
    const candidate = await findNickname(mode, raw)
    state.registerModeProfile(mode, {
      accountId: candidate.accountId,
      enteredNickname: cleanNickname(raw),
      nickname: candidate.nickname,
      verifiedAt: new Date().toISOString(),
    })
    if (candidate.snapshot) state.updatePlayerSnapshot(mode, candidate.snapshot)
    void saveNicknamesOnServer({ [mode]: candidate.nickname })
    refresh()
    return candidate
  }
}
