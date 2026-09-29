import { useEffect, useState } from 'react'
import { useAppState } from '../state/AppState'
import { canResolvePlayerProfiles, desktopPlayerProfileGateway } from './playerProfileGateway'

const REFRESH_INTERVAL = 60_000

export function usePlayerProfileSync() {
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const [syncError, setSyncError] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)

  useEffect(() => {
    if (!canResolvePlayerProfiles() || progress.registration.status !== 'registered' || !progress.registration.accountId) return
    let active = true
    const refresh = async () => {
      setIsSyncing(true)
      try {
        const snapshot = await desktopPlayerProfileGateway().fetchByAccountId(state.raidMode, progress.registration.accountId!)
        if (!active) return
        state.updatePlayerSnapshot(state.raidMode, snapshot)
        setSyncError('')
      } catch (error) {
        if (active) setSyncError(error instanceof Error ? error.message : 'Не удалось обновить профиль')
      } finally {
        if (active) setIsSyncing(false)
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, REFRESH_INTERVAL)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  // The mode, binding and upstream timestamp are the synchronization identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.raidMode, progress.registration.accountId, progress.registration.status])

  return { syncError, isSyncing }
}
