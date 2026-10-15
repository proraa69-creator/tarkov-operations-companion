/**
 * The conditions of a kill objective (tarkov.dev TaskObjectiveShoot) in the catalog's compact form (ObjectiveConditions,
 * src/domain/types.ts): the weapon, its parts, the gear to wear or not to wear, the distance, body parts, targets, hours
 * and effects. «Работа для патриота»: an AK-12 with its original suppressor and the PS-320 scope.
 *
 * Both upstream shapes are accepted, as in objectiveDetails.ts:
 *   - json.tarkov.dev `{mode}/tasks` (what the app loads): `usingWeapon: [id]`, `usingWeaponMods: [[id]]`,
 *     `wearing: [[{ id, name }]]`, `notWearing: [{ id, name }]`, `distance: { compareMethod, value }`;
 *   - the GraphQL API: the same fields with `{ id, name }` objects everywhere.
 * The texts of the JSON feed (`bodyParts`, `targetNames`, effects) are translation keys the `_ru` / `_en` dictionaries
 * turn into words; `raw` is the untranslated objective, so the game's keys (Head, AnyPmc…) stay known.
 *
 * Alternatives are kept as the game stores them (BSG `weaponModsInclusive` / `equipmentInclusive`): a list of options,
 * any one option will do, every item of it is needed. tarkov-data-manager (update-quests) adds the options of every
 * Equipment condition of the objective to one `wearing` list, so «Модники» (a Bomber beanie AND RayBench glasses, two
 * conditions) reads as two options of one item each, like «any of three Goons rigs». One item per equipment slot can be
 * worn: single-item options of different slots (the item's own category, `categories[0]`) can only be meant together,
 * and they are joined into options of one item per slot. Options of the same slot stay alternatives.
 */
import type { ItemRef, ObjectiveConditions } from '../domain/types'

type JsonRecord = Record<string, unknown>

export interface ConditionContext {
  /** The item's name in the catalog's language (the catalog's items), when known. */
  itemName?: (id: string) => string | undefined
  /** The item's equipment slot: its own category id (tarkov.dev `categories[0]`), when known. */
  itemSlot?: (id: string) => string | undefined
}

const asRecord = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
const refId = (value: unknown) => text(value) || text(asRecord(value).id)
const finite = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}
/** An untranslated tarkov.dev text: a translation key («<id> Name», «QuestCondition/…»), not a word. */
const isKey = (value: string) => /^[0-9a-f]{24}\s/i.test(value) || value.includes('/')

/** Most options a joined set of gear may have; past it the upstream list is kept as it is. */
const MAX_JOINED_OPTIONS = 64

function itemRef(value: unknown, context: ConditionContext): ItemRef | undefined {
  const id = refId(value)
  if (!id) return undefined
  const inline = text(asRecord(value).name)
  const name = context.itemName?.(id) || (inline && !isKey(inline) ? inline : '') || id
  return { id, name }
}

function refs(value: unknown, context: ConditionContext): ItemRef[] {
  const seen = new Set<string>()
  return list(value).flatMap((entry) => {
    const ref = itemRef(entry, context)
    if (!ref || seen.has(ref.id)) return []
    seen.add(ref.id)
    return [ref]
  })
}

/** `[[a, b], [c]]` → options; a flat list (an older shape) is one option per item. Empty options are dropped. */
function options(value: unknown, context: ConditionContext): ItemRef[][] {
  return list(value).map((entry) => refs(Array.isArray(entry) ? entry : [entry], context)).filter((option) => option.length > 0)
}

/**
 * `wearing` options as the game means them: single-item options of different equipment slots are separate conditions
 * merged upstream, so every option takes one item of each slot («Модники»: beanie + glasses). Anything else as it is.
 */
export function joinMergedGear(gear: ItemRef[][], slotOf: ((id: string) => string | undefined) | undefined): ItemRef[][] {
  if (gear.length < 2 || !slotOf || gear.some((option) => option.length !== 1)) return gear
  const bySlot = new Map<string, ItemRef[]>()
  for (const [item] of gear) {
    const slot = slotOf(item.id)
    if (!slot) return gear
    bySlot.set(slot, [...bySlot.get(slot) ?? [], item])
  }
  if (bySlot.size < 2) return gear
  const slots = [...bySlot.values()]
  if (slots.reduce((product, items) => product * items.length, 1) > MAX_JOINED_OPTIONS) return gear
  return slots.reduce<ItemRef[][]>((joined, items) => joined.flatMap((option) => items.map((item) => [...option, item])), [[]])
}

const ALL_BODY_PARTS = ['Head', 'Chest', 'Stomach', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']

/** The game's key of a body part: «QuestCondition/Elimination/Kill/BodyPart/Head» → «Head». */
function bodyPartKey(value: string) {
  return value.split('/').pop() || value
}

/** Labelled values: the game's key from the raw objective, the catalog's word from the translated one (same index). */
function labelled(translated: unknown, raw: unknown, keyOf: (value: string) => string = (value) => value): Array<{ key: string; name: string }> {
  const words = list(translated).map(text)
  const keys = list(raw).map(text)
  const seen = new Set<string>()
  return words.flatMap((word, index) => {
    const key = keyOf(keys[index] || word)
    if (!key || seen.has(key)) return []
    seen.add(key)
    return [{ key, name: word && !isKey(word) ? word : key }]
  })
}

function effects(value: unknown): string[] {
  return [...new Set(list(asRecord(value).effects).map(text).filter((effect) => effect && !isKey(effect)))]
}

/**
 * The conditions of one objective, or undefined when it asks for none (or is not a kill objective). `objective` is the
 * objective in the catalog's language; `raw` the same objective untranslated (defaults to `objective`).
 */
export function adaptObjectiveConditions(objective: JsonRecord, context: ConditionContext = {}, raw: JsonRecord = objective): ObjectiveConditions | undefined {
  const type = text(objective.type).toLowerCase()
  const shootFields = ['usingWeapon', 'usingWeaponMods', 'wearing', 'notWearing', 'targetNames', 'shotType'].some((field) => field in objective)
  if (type !== 'shoot' && !shootFields) return undefined
  const weapons = refs(objective.usingWeapon, context)
  const mods = options(objective.usingWeaponMods, context)
  const wearing = joinMergedGear(options(objective.wearing, context), context.itemSlot)
  const notWearing = refs(objective.notWearing, context)
  const distanceRecord = asRecord(objective.distance)
  const distanceValue = finite(distanceRecord.value)
  const compare = text(distanceRecord.compareMethod).trim()
  const distance = distanceValue && distanceValue > 0 && (compare === '>=' || compare === '<=' || compare === '>' || compare === '<')
    ? { compare: compare.startsWith('>') ? '>=' as const : '<=' as const, value: distanceValue }
    : undefined
  const parts = labelled(objective.bodyParts, raw.bodyParts, bodyPartKey)
  // All seven parts is any part.
  const bodyParts = ALL_BODY_PARTS.every((part) => parts.some((entry) => entry.key === part)) ? [] : parts
  const targets = labelled(objective.targetNames, raw.targetNames)
  const from = finite(objective.timeFromHour) ?? 0
  const until = finite(objective.timeUntilHour) ?? 0
  // GraphQL names the zones (`zoneNames`); the JSON feed has only their ids and shapes (the objective's `zones`).
  const zoneNames = [...new Set(list(objective.zoneNames).map(text).filter((name) => name && !isKey(name)))]
  const enemyEffects = effects(objective.enemyHealthEffect)
  const playerEffects = effects(objective.playerHealthEffect)
  const conditions: ObjectiveConditions = {
    ...(weapons.length ? { weapons } : {}),
    ...(mods.length ? { mods } : {}),
    ...(wearing.length ? { wearing } : {}),
    ...(notWearing.length ? { notWearing } : {}),
    ...(distance ? { distance } : {}),
    ...(bodyParts.length ? { bodyParts } : {}),
    ...(targets.length ? { targets } : {}),
    ...(zoneNames.length ? { zoneNames } : {}),
    ...(from || until ? { time: { from, until } } : {}),
    ...(text(objective.shotType).toLowerCase() === 'hit' ? { hitOnly: true } : {}),
    ...(enemyEffects.length ? { enemyEffects } : {}),
    ...(playerEffects.length ? { playerEffects } : {}),
  }
  return Object.keys(conditions).length ? conditions : undefined
}

/** The objective asks for a weapon, weapon parts or gear (the Overview's «Условия квестов»). */
export function hasGearConditions(conditions: ObjectiveConditions | undefined): conditions is ObjectiveConditions {
  return Boolean(conditions && (conditions.weapons?.length || conditions.mods?.length || conditions.wearing?.length || conditions.notWearing?.length))
}
