import { cheapestOffer, FULL_ACCESS, type PurchaseAccess } from './buildStats'
import type { AmmoStats, GunOffer, Weapon } from './gunTypes'
import type { BuildTier } from './tieredBuilds'

/**
 * What a build page says besides the parts (owner, 17.10.2026: take into account the builds and remarks of a streamer's
 * public weapon-build post for the 1.0 release): the round to load for each tier and short notes per weapon class and
 * per weapon. The notes are advice, never a change of the computed build.
 */

export interface AmmoPick { ammo: AmmoStats; offer: GunOffer }

/**
 * Below this penetration a calibre's rounds are not worth loading for the tier («играть на патронах ниже — не имеет
 * смысла»): 9x39 only from СП-6 / БП (pen. 50–60). Others: budget takes the most penetration per rouble of rounds with
 * ≥ 30, middle the cheapest with ≥ 40, top the highest penetration anyone sells.
 */
const MIN_PEN_BY_CALIBER: Record<string, number> = { Caliber9x39: 45 }
const TIER_MIN_PEN: Record<BuildTier, number> = { budget: 30, middle: 40, top: 0 }

export function pickAmmo(weapon: Pick<Weapon, 'caliber'>, ammo: AmmoStats[], tier: BuildTier, access: PurchaseAccess = FULL_ACCESS): AmmoPick | undefined {
  const floor = MIN_PEN_BY_CALIBER[weapon.caliber] ?? 0
  const buyable = ammo.filter((round) => round.caliber === weapon.caliber)
    .flatMap((round) => { const offer = cheapestOffer(round, access); return offer && round.penetration >= floor ? [{ ammo: round, offer }] : [] })
  if (!buyable.length) return undefined
  if (tier === 'top') return buyable.reduce((best, pick) => pick.ammo.penetration > best.ammo.penetration || (pick.ammo.penetration === best.ammo.penetration && pick.offer.priceRUB < best.offer.priceRUB) ? pick : best)
  const enough = buyable.filter((pick) => pick.ammo.penetration >= TIER_MIN_PEN[tier])
  if (!enough.length) return buyable.reduce((best, pick) => pick.ammo.penetration > best.ammo.penetration ? pick : best)
  if (tier === 'middle') return enough.reduce((best, pick) => pick.offer.priceRUB < best.offer.priceRUB ? pick : best)
  return enough.reduce((best, pick) => pick.ammo.penetration / pick.offer.priceRUB > best.ammo.penetration / best.offer.priceRUB ? pick : best)
}

/** Notes per class (and calibre), shown above the build. */
export function classNotes(weapon: Pick<Weapon, 'weaponClass' | 'caliber'>): string[] {
  const notes: string[] = []
  if (weapon.caliber === 'Caliber9x39') {
    notes.push('9x39: пуля летит около 300 м/с — оружие эффективно до 50 метров. Только патроны СП-6 и БП (пробитие 50–60); ниже — лучше взять другое оружие на патроне с пробитием 40.')
  } else if (weapon.weaponClass === 'smg' || weapon.weaponClass === 'handgun') {
    notes.push('Пистолетный калибр: урона и бронепробития мало — цельтесь в голову; хорош для быстрого боя на дистанции до 50 метров.')
  } else if (/762x(39|51|54)|366/.test(weapon.caliber) && (weapon.weaponClass === 'assault-rifle' || weapon.weaponClass === 'assault-carbine')) {
    notes.push('«Семёрка»: отдача сильнее, эргономика и скорострельность ниже, зато урон и дальность выше — остаётся сильной и вблизи.')
  }
  return notes
}

/** Notes on single weapons, matched by the short name. */
const WEAPON_NOTES: Array<[RegExp, string]> = [
  [/^АК-308$|^AK-308$/i, 'Заметно дешевле и доступнее других «семёрок», а эффективность выше. Лучше всего на патроне M80 и сильнее.'],
  [/^(Mk47|RD-704)$/i, 'По опыту игроков переоценён: есть подозрение на скрытое ослабление 7.62x39.'],
  [/^MDR$/i, 'В версии 7.62x51 эргономику сильно подняли, но отдача остаётся тяжёлой.'],
  [/^СВДС$|^SVDS$/i, 'На релизе её усилили, но играть с ней всё равно не советуют.'],
  [/^(SR-25|СКС|ОП-СКС)$/i, 'Самая доступная и дешёвая марксманская винтовка.'],
  [/^SAG/i, 'Дешёвый вариант: почти не требует модификаций.'],
  [/^ВПО-209$/i, 'Цифра отдачи около 100, но ощущается мягче, чем 65 у SR-25, особенно на эко-патроне.'],
]

export function weaponNotes(weapon: Pick<Weapon, 'shortName'>): string[] {
  return WEAPON_NOTES.filter(([pattern]) => pattern.test(weapon.shortName.trim())).map(([, note]) => note)
}

/** Next to the recoil numbers: they compare builds of one weapon, not weapons with each other. */
export const RECOIL_NOTE = 'Отдача сравнима только в пределах одного оружия: 35 у одного ствола может ощущаться сильнее, чем 60 у другого.'
