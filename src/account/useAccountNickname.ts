import { useAppState } from '../state/AppState'
import { useServerAccount } from '../sync/serverSync'
import { accountNickname, profileNickname } from './nicknameBinding'
import { useLogNickname } from './logNickname'

/**
 * The one nickname shown everywhere (top bar, sidebar patch, profile, «Личный кабинет»): the newest found in this session
 * (Tarkov.dev, the game's mode selection screen) or typed, else the account's while signed in, else a bound mode's. Never the per-mode Tarkov.dev names — those can be stale in one mode after a rename,
 * which showed different nicknames per mode (owner, 10.10.2026).
 */
export function useAccountNickname() {
  const { status } = useServerAccount()
  const { activeProfile, raidMode } = useAppState()
  const found = useLogNickname()
  return found ?? accountNickname(status?.nicknames) ?? profileNickname(activeProfile, raidMode)
}
