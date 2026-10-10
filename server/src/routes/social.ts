import type express from 'express'
import type { AccountStore } from '../services/accountStore.js'
import { FriendStore } from '../services/friendStore.js'
import type { ProgressStore } from '../services/progressStore.js'
import { SquadStore } from '../services/squadStore.js'
import { socialCircle, type SocialSignals } from '../services/socialSignals.js'
import { createFriendsRouter, type FriendsRouterOptions } from './friends.js'
import type { CatalogPeek } from './me.js'
import { createSquadsRouter, type SquadRouterOptions } from './squads.js'

export interface SocialLimits { squadLimits?: SquadRouterOptions['limits']; friendLimits?: FriendsRouterOptions['limits'] }

/**
 * «Отряд» (/v1/squads) and friends (/v1/friends), on the accounts' database and clock. Returns who sees an account
 * (services/socialSignals.ts) for the instant updates.
 */
export function mountSocial(app: express.Express, accounts: AccountStore, progress: ProgressStore, options: SocialLimits & { catalog?: CatalogPeek; signals?: SocialSignals } = {}) {
  const squads = new SquadStore(accounts.database, accounts.clock)
  const friends = new FriendStore(accounts.database, accounts.clock)
  app.use('/v1/squads', createSquadsRouter(accounts, progress, squads, friends, { catalog: options.catalog, now: accounts.clock, limits: options.squadLimits, signals: options.signals }))
  app.use('/v1/friends', createFriendsRouter(accounts, progress, friends, squads, { catalog: options.catalog, now: accounts.clock, limits: options.friendLimits, signals: options.signals }))
  return (accountId: string) => socialCircle(friends, squads, accountId)
}
