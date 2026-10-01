import type { AccountStore } from './accountStore.js'

/**
 * Paid features (docs/product-roadmap-and-business-model.md, «Subscription model»): an active subscription, the
 * referral trial or a streamer account (lifetime). The service owner always has access. Decided only on the server.
 */
export function hasPaidAccess(accounts: AccountStore, accountId: string) {
  const view = accounts.view(accountId)
  return view.subscription.status !== 'inactive' || view.owner === true
}
