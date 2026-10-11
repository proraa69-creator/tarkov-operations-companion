import { Crown, Lock, Repeat } from 'lucide-react'
import type { Trader } from '../domain/types'
import { loyaltyNumeral } from './traderLevels'
import './traderBadge.css'

/** A trader portrait with the loyalty level (I, II, III, crown), dimmed and locked when the player's level is lower. */
export function TraderBadge({ trader, name, image, level, locked, title, small, barter }: { trader?: Trader; name: string; image?: string; level?: number; locked?: boolean; title?: string; small?: boolean; barter?: boolean }) {
  const picture = trader?.imageUrl ?? image
  return <span className={`gs-trader${locked ? ' is-locked' : ''}${small ? ' is-small' : ''}`} title={title ?? name}>
    {picture ? <img src={picture} alt="" loading="lazy" /> : <span className="gs-trader-initial">{name.slice(0, 1)}</span>}
    {level ? <span className="gs-trader-level" aria-label={`LL${level}`}>{level >= 4 ? <Crown size={small ? 8 : 9} strokeWidth={2.5} aria-hidden="true" /> : loyaltyNumeral(level)}</span> : null}
    {locked && <span className="gs-trader-lock" aria-hidden="true"><Lock size={small ? 8 : 9} /></span>}
    {barter && <span className="gs-trader-barter" aria-hidden="true"><Repeat size={small ? 8 : 9} strokeWidth={2.5} /></span>}
  </span>
}
