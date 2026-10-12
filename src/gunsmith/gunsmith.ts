import type { Quest, TaskProgressStatus, WeaponBuildAttribute, WeaponBuildRequirement } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * «Оружейник» (owner, 10.10.2026): Mechanic's Gunsmith chain, each part «modify this weapon to the given specifications»
 * (named by the weapon in the game now: «Оружейник. АКС-74Н»). Tasks detected in the game logs go to the «Оружейник» block of the Overview only, not to
 * «Текущие задания»; «Посмотреть все» opens every part with its weapon, required parts and stats (src/pages/GunsmithPage.tsx).
 * Everything comes from the live tarkov.dev catalog (buildWeapon objectives, src/data/objectiveDetails.ts), so a new part or
 * changed specification shows up with the next catalog refresh.
 */
const SLUG = /^gunsmith(?:-|$)/i
const PART_NUMBER = /(?:part|часть)\s*(\d+)/i
const NAME = { en: /^\s*[«"']?gunsmith\b/i, ru: /^\s*[«"']?оружейник(?![а-яё])/i }
/** Latin letters that look Cyrillic: the game's own texts mix them in now and then («Oружейник» with a Latin O). */
const LOOKALIKES: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У' }
const asCyrillic = (value: string) => value.replace(/[aceopxyABCEHKMOPTXY]/g, (char) => LOOKALIKES[char] ?? char)

type GunsmithCandidate = Pick<Quest, 'name' | 'normalizedName'> & Partial<Pick<Quest, 'objectiveDetails'>>

/**
 * A task of the Gunsmith chain. The game now names the parts by their weapon («Оружейник. АКС-74Н», «Gunsmith - AKS-74N»),
 * earlier by number («Оружейник. Часть 7», `gunsmith-part-7`); either way it starts with «Оружейник» / «Gunsmith».
 * Every task that asks to build a weapon (buildWeapon objective) counts too, whatever its name (owner, 11.10.2026: all
 * Gunsmith tasks, numbered or not; their status comes from the game logs by task id, their data from our catalog).
 */
export function isGunsmithQuest(quest: GunsmithCandidate): boolean {
  if (SLUG.test(quest.normalizedName ?? '')) return true
  if (NAME.en.test(quest.name) || NAME.ru.test(asCyrillic(quest.name))) return true
  return Boolean(weaponBuildOf(quest))
}

/** The Gunsmith page opened at this task. */
export const gunsmithHref = (quest: Pick<Quest, 'id'>) => `/gunsmith?quest=${encodeURIComponent(quest.id)}`

/** The weapon build a quest asks for (its first buildWeapon objective). */
export function weaponBuildOf(quest: Partial<Pick<Quest, 'objectiveDetails'>>): WeaponBuildRequirement | undefined {
  return quest.objectiveDetails?.find((objective) => objective.build)?.build
}

/** Every weapon a quest asks to build (some later Gunsmith parts take two or three), in the objectives' order. */
export function weaponBuildsOf(quest: Partial<Pick<Quest, 'objectiveDetails'>>): WeaponBuildRequirement[] {
  return (quest.objectiveDetails ?? []).flatMap((objective) => (objective.build ? [objective.build] : []))
}

export interface GunsmithStep {
  quest: Quest
  /** Place in the chain, from 1. */
  part: number
  status: TaskProgressStatus
  build?: WeaponBuildRequirement
  /** All the weapons the part asks to build (`build` is the first). */
  builds: WeaponBuildRequirement[]
}

/**
 * Every Gunsmith task of this mode's catalog in chain order with its status. The order is the chain itself (each part
 * needs the one before), then the level the part opens at, then a part number when the name has one («Мастер. Часть 3»).
 */
export function gunsmithSteps(quests: Quest[], statusOf: (questId: string) => TaskProgressStatus | undefined): GunsmithStep[] {
  const byName = new Map<string, Quest>()
  for (const quest of quests) {
    if (quest.id.startsWith('wiki:') || !isGunsmithQuest(quest)) continue
    // One task per name (a stale duplicate from another data source never doubles a part); the one with the build wins.
    const key = asCyrillic(quest.normalizedName || quest.name).toLowerCase().replace(/\s+/g, ' ').trim()
    const known = byName.get(key)
    if (known && (weaponBuildOf(known) || !weaponBuildOf(quest))) continue
    byName.set(key, quest)
  }
  const chain = new Map([...byName.values()].map((quest) => [quest.id, quest]))
  const depths = new Map<string, number>()
  const depthOf = (quest: Quest, seen: Set<string>): number => {
    const known = depths.get(quest.id)
    if (known !== undefined) return known
    seen.add(quest.id)
    const before = [...new Set([...(quest.previous ?? []), ...(quest.requirements ?? []).map((requirement) => requirement.taskId)])]
      .map((id) => chain.get(id))
      .filter((entry): entry is Quest => Boolean(entry) && !seen.has(entry!.id))
    const depth = before.length ? 1 + Math.max(...before.map((entry) => depthOf(entry, seen))) : 0
    seen.delete(quest.id)
    depths.set(quest.id, depth)
    return depth
  }
  const number = (quest: Quest) => Number(PART_NUMBER.exec(quest.name)?.[1] ?? /-part-(\d+)/.exec(quest.normalizedName ?? '')?.[1] ?? Number.POSITIVE_INFINITY)
  return [...chain.values()]
    .map((quest) => ({ quest, depth: depthOf(quest, new Set()), number: number(quest) }))
    .sort((a, b) => a.depth - b.depth || a.quest.level - b.quest.level || a.number - b.number || a.quest.name.localeCompare(b.quest.name))
    .map(({ quest }, index) => ({ quest, part: index + 1, status: statusOf(quest.id) ?? 'unknown', build: weaponBuildOf(quest), builds: weaponBuildsOf(quest) }))
}

/**
 * What the Overview block shows: the parts taken in the game, else the next one to take, and the chain progress. A part
 * the logs say nothing about (status unknown, requirementEngine.ts) is never offered as the next one.
 */
export function gunsmithSummary(steps: GunsmithStep[]) {
  const active = steps.filter((step) => step.status === 'active')
  const done = steps.filter((step) => step.status === 'completed').length
  const unknown = steps.filter((step) => step.status === 'unknown').length
  const next = active.length ? undefined : steps.find((step) => step.status !== 'completed' && step.status !== 'unknown')
  return { active, next, done, unknown, total: steps.length }
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

/**
 * «выполнено», «принято в игре», «доступно у Механика», «с 25 уровня» (already in the interface language). A part the
 * logs say nothing about gets no words at all — it is only dimmed (owner, 12.10.2026: «где написано нет в логах игры,
 * не нужно это писать, просто держи их притемнёнными»).
 */
export function stepStatus(step: GunsmithStep, playerLevel: number, locale: AppLocale) {
  const en = locale === 'en'
  if (step.status === 'completed') return en ? 'done' : 'выполнено'
  if (step.status === 'active') return en ? 'taken in the game' : 'принято в игре'
  if (step.status === 'failed') return en ? 'failed' : 'провалено'
  if (step.status === 'available') return en ? 'available from Mechanic' : 'доступно у Механика'
  if (step.status === 'unknown') return ''
  if (playerLevel < step.quest.level) return en ? `from level ${step.quest.level}` : `с ${step.quest.level} уровня`
  return en ? 'after the previous part' : 'после предыдущей части'
}
