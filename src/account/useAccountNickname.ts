import { useAppState } from '../state/AppState'
import { useServerAccount } from '../sync/serverSync'
import { accountNickname, profileNickname } from './nicknameBinding'

/**
 * The one nickname shown everywhere (top bar, sidebar patch, profile, «Личный кабинет»): the account's while signed in,
 * else the one typed in this app. Never the per-mode Tarkov.dev names — those can be stale in one mode after a rename,
 * which showed different nicknames per mode (owner, 10.10.2026).
 */
export function useAccountNickname() {
  const { status } = useServerAccount()
  const { activeProfile, raidMode } = useAppState()
  return accountNickname(status?.nicknames) ?? profileNickname(activeProfile, raidMode)
}
