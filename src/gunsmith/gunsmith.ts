import type { Quest, TaskProgressStatus, WeaponBuildAttribute, WeaponBuildRequirement } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * «Оружейник» (owner, 10.10.2026): Mechanic's Gunsmith chain — Part 1 … Part N, each one «modify this weapon to the
 * given specifications». Tasks detected in the game logs go to the «Оружейник» block of the Overview only, not to
 * «Текущие задания»; «Посмотреть все» opens every part with its weapon, required parts and stats (src/pages/GunsmithPage.tsx).
 * Everything comes from the live tarkov.dev catalog (buildWeapon objectives, src/data/objectiveDetails.ts), so a new part or
 * changed specification shows up with the next catalog refresh.
 */
const SLUG = /^gunsmith-part-(\d+)$/
const NAMES = [/gunsmith\s*[-–—.:]?\s*part\s*(\d+)/i, /оружейник\.?\s*[-–—.:]?\s*часть\s*(\d+)/i]

/** Part number of a Gunsmith task (normalizedName `gunsmith-part-7`, «Оружейник. Часть 7», «Gunsmith - Part 7»), else null. */
export function gunsmithPart(quest: Pick<Quest, 'name' | 'normalizedName'>): number | null {
  const slug = SLUG.exec(quest.normalizedName ?? '')
  if (slug) return Number(slug[1])
  for (const pattern of NAMES) {
    const match = pattern.exec(quest.name)
    if (match) return Number(match[1])
  }
  return null
}

export const isGunsmithQuest = (quest: Pick<Quest, 'name' | 'normalizedName'>) => gunsmithPart(quest) !== null

/** The weapon build a quest asks for (its first buildWeapon objective). */
export function weaponBuildOf(quest: Pick<Quest, 'objectiveDetails'>): WeaponBuildRequirement | undefined {
  return quest.objectiveDetails?.find((objective) => objective.build)?.build
}

export interface GunsmithStep {
  quest: Quest
  part: number
  status: TaskProgressStatus
  build?: WeaponBuildRequirement
}

/** Every Gunsmith part in chain order with its status in this mode. */
export function gunsmithSteps(quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined): GunsmithStep[] {
  const byPart = new Map<number, GunsmithStep>()
  for (const quest of quests) {
    const part = gunsmithPart(quest)
    if (part === null || quest.id.startsWith('wiki:')) continue
    // One task per part (a stale duplicate from another data source never doubles a part).
    if (byPart.has(part) && !weaponBuildOf(quest)) continue
    byPart.set(part, { quest, part, status: statusOf(quest.id) ?? 'unknown', build: weaponBuildOf(quest) })
  }
  return [...byPart.values()].sort((a, b) => a.part - b.part)
}

/** What the Overview block shows: the parts taken in the game, else the next one to take, and the chain progress. */
export function gunsmithSummary(steps: GunsmithStep[]) {
  const active = steps.filter((step) => step.status === 'active')
  const done = steps.filter((step) => step.status === 'completed').length
  const next = active.length ? undefined : steps.find((step) => step.status !== 'completed')
  return { active, next, done, total: steps.length }
}

interface AttributeInfo { ru: string; en: string; unit?: { ru: string; en: string }; hint?: { ru: string; en: string } }

/** tarkov.dev attribute names in the words of the game (tarkov.dev's own site leaves «effectiveDistance» untranslated). */
export const BUILD_ATTRIBUTES: Record<string, AttributeInfo> = {
  ergonomics: { ru: 'Эргономика', en: 'Ergonomics' },
  recoil: { ru: 'Отдача (верт. + гор.)', en: 'Recoil (vertical + horizontal)' },
  weight: { ru: 'Вес', en: 'Weight', unit: { ru: 'кг', en: 'kg' } },
  magazineCapacity: { ru: 'Вместимость магазина', en: 'Magazine capacity', unit: { ru: 'патр.', en: 'rds' } },
  durability: { ru: 'Прочность', en: 'Durability', hint: { ru: 'Берите оружие у торговца: оно новое, с полной прочностью.', en: 'Buy the weapon from a trader: it comes new, at full durability.' } },
  effectiveDistance: { ru: 'Эффективная дальность', en: 'Effective distance', unit: { ru: 'м', en: 'm' }, hint: { ru: 'Зависит от ствола: длиннее ствол — больше дальность.', en: 'Depends on the barrel: a longer barrel gives more distance.' } },
  muzzleVelocity: { ru: 'Начальная скорость пули', en: 'Muzzle velocity', unit: { ru: 'м/с', en: 'm/s' }, hint: { ru: 'Зависит от ствола и дульного устройства.', en: 'Depends on the barrel and the muzzle device.' } },
  accuracy: { ru: 'Точность', en: 'Accuracy', hint: { ru: 'Зависит от ствола и дульного устройства.', en: 'Depends on the barrel and the muzzle device.' } },
  width: { ru: 'Ширина', en: 'Width', unit: { ru: 'кл.', en: 'cells' }, hint: { ru: 'Сложенный или короткий приклад уменьшает ширину.', en: 'A folded or short stock makes it narrower.' } },
  height: { ru: 'Высота', en: 'Height', unit: { ru: 'кл.', en: 'cells' }, hint: { ru: 'Длинный магазин и рукоятки увеличивают высоту.', en: 'Long magazines and grips make it taller.' } },
}

/** Attributes the build calculator checks (src/gunsmith/gunsmithSolver.ts); the rest are checked in the game. */
export const COMPUTED_ATTRIBUTES = new Set(['ergonomics', 'recoil', 'weight', 'magazineCapacity'])

const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase())

export function attributeLabel(name: string, locale: AppLocale) {
  const info = BUILD_ATTRIBUTES[name]
  return info ? info[locale] : humanize(name)
}

export function attributeHint(name: string, locale: AppLocale) {
  return BUILD_ATTRIBUTES[name]?.hint?.[locale]
}

const SIGNS: Record<WeaponBuildAttribute['compare'], string> = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '=': '=' }

const number = (value: number, locale: AppLocale) => value.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 3 })

/** «≥ 50», «≤ 4 кг». */
export function formatTarget(attribute: WeaponBuildAttribute, locale: AppLocale) {
  const unit = BUILD_ATTRIBUTES[attribute.name]?.unit?.[locale]
  return `${SIGNS[attribute.compare]} ${number(attribute.value, locale)}${unit ? ` ${unit}` : ''}`
}

export function formatValue(name: string, value: number, locale: AppLocale) {
  const unit = BUILD_ATTRIBUTES[name]?.unit?.[locale]
  return `${number(value, locale)}${unit ? ` ${unit}` : ''}`
}

/** Whether `actual` satisfies the requirement. */
export function meets(attribute: WeaponBuildAttribute, actual: number) {
  const value = attribute.value
  switch (attribute.compare) {
    case '>=': return actual >= value
    case '<=': return actual <= value + 1e-9
    case '>': return actual > value
    case '<': return actual < value
    default: return Math.abs(actual - value) < 1e-9
  }
}

/** How far `actual` is from the requirement, relative to it (0 when met). */
export function shortfall(attribute: WeaponBuildAttribute, actual: number) {
  if (meets(attribute, actual)) return 0
  const scale = Math.max(Math.abs(attribute.value), attribute.name === 'weight' ? 0.1 : 1)
  // A strict comparison needs one step past the value.
  const step = attribute.name === 'weight' ? 0.001 : 1
  const target = attribute.compare === '>' ? attribute.value + step : attribute.compare === '<' ? attribute.value - step : attribute.value
  return Math.abs(actual - target) / scale + 1e-6
}

/** «выполнено», «принято в игре», «доступно у Механика», «с 25 уровня» (already in the interface language). */
export function stepStatus(step: GunsmithStep, playerLevel: number, locale: AppLocale) {
  const en = locale === 'en'
  if (step.status === 'completed') return en ? 'done' : 'выполнено'
  if (step.status === 'active') return en ? 'taken in the game' : 'принято в игре'
  if (step.status === 'failed') return en ? 'failed' : 'провалено'
  if (step.status === 'available') return en ? 'available from Mechanic' : 'доступно у Механика'
  if (playerLevel < step.quest.level) return en ? `from level ${step.quest.level}` : `с ${step.quest.level} уровня`
  return en ? 'after the previous part' : 'после предыдущей части'
}
