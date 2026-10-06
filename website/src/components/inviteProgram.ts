/** «Пригласи друга»: ranks, wording and statuses shared by the cabinet panel and the home page (InviteFriendsPanel.tsx). */
import type { InviteProgram, InviteRank, InviteReward, InviteRewardStatus } from '../api'

const releaseFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

/** The ranks of «Пригласи друга» (mirrors RANKS in server/src/services/invites.ts): used before the program loads and on the home page. */
export const INVITE_RANKS: InviteRank[] = [
  { id: 'scout', title: 'Scout', friends: 1, bonusDays: 0 },
  { id: 'operator', title: 'Operator', friends: 3, bonusDays: 30 },
  { id: 'squad-leader', title: 'Squad Leader', friends: 10, bonusDays: 90 },
  { id: 'raid-commander', title: 'Raid Commander', friends: 25, bonusDays: 365 },
  { id: 'legend', title: 'Legend', friends: 50, bonusDays: 'lifetime' },
]

/** 1 день, 2 дня, 5 дней — Russian plural by the last digits. */
export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** «месяц», «3 месяца», «год», «Premium навсегда», «7 дней». */
export function bonusText(days: number | 'lifetime') {
  if (days === 'lifetime') return 'Premium навсегда'
  if (days === 365) return 'год'
  if (days === 30) return 'месяц'
  if (days > 0 && days % 30 === 0) return `${days / 30} ${plural(days / 30, 'месяц', 'месяца', 'месяцев')}`
  return `${days} ${plural(days, 'день', 'дня', 'дней')}`
}

/** What a rank gives: Scout — the per-friend days, the others — their one-off bonus. */
export function rankReward(rank: InviteRank, rewardDays = 7) {
  if (rank.bonusDays === 'lifetime') return 'Premium навсегда'
  if (rank.bonusDays === 0) return `${bonusText(rewardDays)} за друга`
  return `+${bonusText(rank.bonusDays)}`
}

export const REWARD_STATUS: Record<InviteRewardStatus, { label: string; tone: string }> = {
  pending: { label: 'На проверке', tone: '' },
  review: { label: 'Проверяет администрация', tone: 'brass' },
  granted: { label: 'Начислено', tone: 'green' },
  canceled: { label: 'Не засчитано', tone: 'danger' },
}

export function rewardStatusText(reward: InviteReward) {
  if (reward.status === 'pending' && reward.releaseAt) return `На проверке до ${releaseFormat.format(new Date(reward.releaseAt))}`
  return REWARD_STATUS[reward.status]?.label ?? reward.status
}

/** «Ещё 2 оплаты до Operator — +1 месяц Premium». */
export function progressText(program: Pick<InviteProgram, 'confirmed' | 'next' | 'rewardDays'>) {
  const next = program.next
  if (!next) return 'Высший ранг получен — Premium навсегда. Спасибо, что зовёте друзей!'
  const left = Math.max(next.friends - program.confirmed, 0)
  const reward = next.bonusDays === 'lifetime' ? 'Premium навсегда'
    : next.bonusDays === 0 ? `${bonusText(program.rewardDays)} Premium за каждого друга`
      : `+${next.bonusDays === 30 ? '1 месяц' : next.bonusDays === 365 ? '1 год' : bonusText(next.bonusDays)} Premium`
  return `Ещё ${left} ${plural(left, 'оплата', 'оплаты', 'оплат')} до ${next.title} — ${reward}`
}
