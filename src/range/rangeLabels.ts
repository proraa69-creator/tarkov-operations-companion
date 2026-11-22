/** Russian and English names of the range's zones, body parts, armour slots and target groups. */
import type { BodyPart, Collider, LayerOutcome } from './rangeModel'

type Pair = readonly [ru: string, en: string]

export const PART_NAMES: Record<BodyPart, Pair> = {
  Head: ['Голова', 'Head'], Chest: ['Грудь', 'Thorax'], Stomach: ['Живот', 'Stomach'],
  LeftArm: ['Левая рука', 'Left arm'], RightArm: ['Правая рука', 'Right arm'], LeftLeg: ['Левая нога', 'Left leg'], RightLeg: ['Правая нога', 'Right leg'],
}

export const PART_SHORT: Record<BodyPart, Pair> = {
  Head: ['Голова', 'Head'], Chest: ['Грудь', 'Thorax'], Stomach: ['Живот', 'Stomach'],
  LeftArm: ['Л. рука', 'L. arm'], RightArm: ['П. рука', 'R. arm'], LeftLeg: ['Л. нога', 'L. leg'], RightLeg: ['П. нога', 'R. leg'],
}

export const COLLIDER_NAMES: Record<Collider, Pair> = {
  HeadCommon: ['Лицо', 'Face'], ParietalHead: ['Макушка', 'Top of head'], BackHead: ['Затылок', 'Back of head'], Ears: ['Уши', 'Ears'],
  Eyes: ['Глаза', 'Eyes'], Jaw: ['Челюсть', 'Jaw'], NeckFront: ['Шея спереди', 'Throat'], NeckBack: ['Шея сзади', 'Nape'],
  RibcageUp: ['Грудь', 'Upper chest'], SpineTop: ['Спина вверху', 'Upper back'], LeftSideChestUp: ['Левый бок вверху', 'Left upper side'], RightSideChestUp: ['Правый бок вверху', 'Right upper side'],
  RibcageLow: ['Живот', 'Lower chest'], SpineDown: ['Поясница', 'Lower back'], LeftSideChestDown: ['Левый бок', 'Left side'], RightSideChestDown: ['Правый бок', 'Right side'],
  Pelvis: ['Пах', 'Pelvis'], PelvisBack: ['Ягодицы', 'Buttocks'],
  LeftUpperArm: ['Левое плечо', 'Left upper arm'], LeftForearm: ['Левое предплечье', 'Left forearm'], RightUpperArm: ['Правое плечо', 'Right upper arm'], RightForearm: ['Правое предплечье', 'Right forearm'],
  LeftThigh: ['Левое бедро', 'Left thigh'], LeftCalf: ['Левая голень', 'Left calf'], RightThigh: ['Правое бедро', 'Right thigh'], RightCalf: ['Правая голень', 'Right calf'],
}

/** Armour slots of carriers and helmets, by the game's slot name (lower case). */
const SLOT_NAMES: Record<string, Pair> = {
  front_plate: ['Плита спереди', 'Front plate'], back_plate: ['Плита сзади', 'Back plate'],
  left_side_plate: ['Боковая плита слева', 'Left side plate'], right_side_plate: ['Боковая плита справа', 'Right side plate'],
  soft_armor_front: ['Вставка спереди', 'Front insert'], soft_armor_back: ['Вставка сзади', 'Back insert'],
  soft_armor_left: ['Вставка слева', 'Left insert'], soft_armor_right: ['Вставка справа', 'Right insert'],
  collar: ['Воротник', 'Collar'], groin: ['Пах', 'Groin'], groin_back: ['Пах сзади', 'Groin back'],
  shoulder_l: ['Левое плечо', 'Left shoulder'], shoulder_r: ['Правое плечо', 'Right shoulder'],
  helmet_top: ['Шлем: макушка', 'Helmet: top'], helmet_back: ['Шлем: затылок', 'Helmet: back'], helmet_ears: ['Шлем: уши', 'Helmet: ears'],
  helmet_eyes: ['Шлем: глаза', 'Helmet: eyes'], helmet_jaw: ['Шлем: челюсть', 'Helmet: jaw'],
}

/** A piece's label: its slot (`body:armor:Soft_armor_front` → «Вставка спереди»), else its own name. */
export function pieceLabel(key: string, name: string, locale: 'ru' | 'en') {
  const slot = key.split(':').pop()?.toLowerCase() ?? ''
  const pair = SLOT_NAMES[slot]
  return pair ? pair[locale === 'en' ? 1 : 0] : name
}

export const OUTCOME_NAMES: Record<LayerOutcome, Pair> = {
  through: ['пробита', 'penetrated'], stopped: ['не пробита', 'stopped'], ricochet: ['рикошет', 'ricochet'], broken: ['разбита', 'broken'], behind: ['за бронёй', 'behind'],
}

export const GROUP_NAMES: Record<'all' | 'pmc' | 'scav' | 'boss' | 'follower', Pair> = {
  all: ['Все', 'All'], pmc: ['ЧВК', 'PMC'], scav: ['Дикие и рейдеры', 'Scavs and raiders'], boss: ['Боссы', 'Bosses'], follower: ['Свита и охрана', 'Followers'],
}

/** Start states: which parts are blacked out before the first shot. */
export const START_STATES: Array<{ key: string; ru: string; en: string; parts: BodyPart[] }> = [
  { key: 'healthy', ru: 'Здоров', en: 'Healthy', parts: [] },
  { key: 'arm', ru: 'Выбита рука', en: 'Arm blacked', parts: ['LeftArm'] },
  { key: 'leg', ru: 'Выбита нога', en: 'Leg blacked', parts: ['LeftLeg'] },
  { key: 'stomach', ru: 'Выбит живот', en: 'Stomach blacked', parts: ['Stomach'] },
  { key: 'arms', ru: 'Выбиты обе руки', en: 'Both arms blacked', parts: ['LeftArm', 'RightArm'] },
  { key: 'legs', ru: 'Выбиты обе ноги', en: 'Both legs blacked', parts: ['LeftLeg', 'RightLeg'] },
  { key: 'limbs', ru: 'Выбиты руки и ноги', en: 'All limbs blacked', parts: ['LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'] },
]

export const FIRE_MODE_NAMES: Record<string, Pair> = {
  single: ['Одиночный', 'Single'], semiauto: ['Одиночный', 'Semi-auto'], doubleaction: ['Самовзвод', 'Double action'],
  burst: ['Отсечка', 'Burst'], doublet: ['Двойной', 'Doublet'], fullauto: ['Автомат', 'Full auto'],
}

export const pick = (pair: Pair, locale: string) => pair[locale === 'en' ? 1 : 0]

/**
 * The covers by what stands there (owner, 22.11.2026: «укрытие слева, укрытие справа. Низкое укрытие переименуй в тот объект,
 * который будет у нас стоять… И окно… Окно в здании лучше»).
 */
export const COVER_NAMES: Record<'none' | 'left' | 'right' | 'low' | 'window', Pair> = {
  none: ['Нет', 'None'], left: ['Укрытие слева', 'Cover on the left'], right: ['Укрытие справа', 'Cover on the right'],
  low: ['Ящики', 'Crates'], window: ['Окно в здании', 'Window in a building'],
}
