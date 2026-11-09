import { useEffect, useRef } from 'react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { refreshServerStatus, useServerAccount } from '../sync/serverSync'

export const FIRST_RAID_PATH = '/v1/accounts/me/first-raid'

/**
 * Desktop only (App): the free days count from the first raid (owner, 08.11.2026: «пошли в первый рейд… После этого
 * начинается отсчёт 2 дней»). While the account's days wait for it (`trialRaidDays`, server AccountStore.firstRaid), the
 * first raid start the game logs show is reported once; the status is then asked for again (the end date appears).
 */
export function FirstRaidReport() {
  const { status } = useServerAccount()
  const raid = useRaidState()
  const sent = useRef('')
  const email = status?.signedIn && status.online ? status.email : undefined
  const waiting = Boolean(status?.signedIn && status.subscription?.status === 'trial' && status.subscription.trialRaidDays)
  useEffect(() => {
    const request = window.tarkovDesktop?.serviceRequest
    if (!request || !email || !waiting || !raidRunning(raid, Date.now()) || sent.current === email) return
    sent.current = email
    request('POST', FIRST_RAID_PATH)
      .then(() => { void refreshServerStatus() })
      // Offline or a server without the route yet: the next raid tries again.
      .catch(() => { sent.current = '' })
  }, [email, waiting, raid])

  return null
}
