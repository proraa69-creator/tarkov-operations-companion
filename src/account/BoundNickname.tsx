import { Check, UserRound } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { modeTitle } from './nicknameBinding'
import type { NicknameBinding } from './useNicknameBinder'

/** «shaurma · PvP · PvE · уровень 41 — Привязан»: the bound nickname and the modes where its profile was found. */
export function BoundNickname({ binding }: { binding: NicknameBinding }) {
  const { candidate, modes } = binding
  return (
    <div className="profile-candidate account-bound" role="status">
      <span className="profile-avatar small"><UserRound size={20} /></span>
      <span><strong>{candidate.nickname}</strong><small>{modes.map((mode) => uiText(modeTitle(mode))).join(' · ')}{candidate.pending ? uiText(' · уровень появится, когда обновится профиль игрока') : <>{uiText(' · уровень ')}{candidate.level}</>}</small></span>
      <span className="tag green"><Check size={12} />{uiText('Привязан')}</span>
    </div>
  )
}
