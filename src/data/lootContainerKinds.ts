import type { MapMarker } from '../domain/types'

/**
 * Loot by kind on the map (owner, 06.11.2026: «сделай маркеры сейфа куртки и тд, как в игре… без кругов и фона, просто картинка»).
 * tarkov.dev has one id per model of a container: several ids can be one kind for the player («Оружейный кофр», «Большой
 * оружейный кофр», «Зелёный оружейный ящик»).
 */
export type LootContainerKind =
  | 'safe' | 'cash-register' | 'jacket' | 'duffle-bag' | 'medbag' | 'medcase' | 'toolbox' | 'pc-block' | 'drawer' | 'plastic-suitcase'
  | 'weapon-box' | 'grenade-box' | 'wooden-ammo-box' | 'wooden-crate'
  | 'technical-supply-crate' | 'medical-supply-crate' | 'ration-supply-crate'
  | 'buried-barrel-cache' | 'ground-cache' | 'shturmans-stash'
  | 'dead-scav' | 'pmc-body' | 'civilian-body' | 'lab-technician-body'

/** In the order of the map's list: what players look for first. */
export const LOOT_CONTAINER_KINDS: ReadonlyArray<{ kind: LootContainerKind; ru: string; en: string }> = [
  { kind: 'safe', ru: 'Сейф', en: 'Safe' },
  { kind: 'cash-register', ru: 'Кассовый аппарат', en: 'Cash register' },
  { kind: 'jacket', ru: 'Куртка', en: 'Jacket' },
  { kind: 'duffle-bag', ru: 'Спортивная сумка', en: 'Duffle bag' },
  { kind: 'medbag', ru: 'Медсумка', en: 'Medbag' },
  { kind: 'medcase', ru: 'Медукладка', en: 'Medcase' },
  { kind: 'toolbox', ru: 'Ящик для инструментов', en: 'Toolbox' },
  { kind: 'pc-block', ru: 'Системный блок', en: 'PC block' },
  { kind: 'drawer', ru: 'Выдвижной ящик', en: 'Drawer' },
  { kind: 'plastic-suitcase', ru: 'Пластиковый чемодан', en: 'Plastic suitcase' },
  { kind: 'weapon-box', ru: 'Оружейный ящик', en: 'Weapon box' },
  { kind: 'grenade-box', ru: 'Гранатный ящик', en: 'Grenade box' },
  { kind: 'wooden-ammo-box', ru: 'Патронный ящик', en: 'Wooden ammo box' },
  { kind: 'wooden-crate', ru: 'Деревянный ящик', en: 'Wooden crate' },
  { kind: 'technical-supply-crate', ru: 'Ящик техснабжения', en: 'Technical supply crate' },
  { kind: 'medical-supply-crate', ru: 'Ящик медобеспечения', en: 'Medical supply crate' },
  { kind: 'ration-supply-crate', ru: 'Ящик с продовольствием', en: 'Ration supply crate' },
  { kind: 'buried-barrel-cache', ru: 'Закопанная бочка', en: 'Buried barrel cache' },
  { kind: 'ground-cache', ru: 'Закопанный ящик', en: 'Ground cache' },
  { kind: 'shturmans-stash', ru: 'Схрон Штурмана', en: "Shturman's stash" },
  { kind: 'dead-scav', ru: 'Труп дикого', en: 'Dead Scav' },
  { kind: 'pmc-body', ru: 'Труп бойца ЧВК', en: 'PMC body' },
  { kind: 'civilian-body', ru: 'Труп гражданского', en: 'Civilian body' },
  { kind: 'lab-technician-body', ru: 'Труп лаборанта', en: 'Lab technician body' },
]

/** tarkov.dev's `lootContainer` ids on the maps (05.11.2026: 43 ids, 7 098 points). An id not here stays a plain container. */
const KIND_OF_CONTAINER: Readonly<Record<string, LootContainerKind>> = {
  '578f87a3245977356274f2cb': 'duffle-bag', '61aa1e9a32a4743c3453d2cf': 'duffle-bag',
  '578f87b7245977356274f2cd': 'drawer',
  '5909d50c86f774659e6aaebe': 'toolbox', '67adf54d1c58bd68b2002ff0': 'toolbox',
  '578f87ad245977356274f2cc': 'wooden-crate', '67adf4db515e3dd542077a1d': 'wooden-crate',
  '5909d5ef86f77467974efbd8': 'weapon-box', '5909d7cf86f77470ee57d75a': 'weapon-box', '5909d76c86f77471e53d2adf': 'weapon-box', '5909d89086f77472591234a0': 'weapon-box',
  '578f8778245977358849a9b5': 'jacket', '67adf4a95247ac91530fcec7': 'jacket', '59387ac686f77401442ddd61': 'jacket', '5914944186f774189e5e76c2': 'jacket', '5937ef2b86f77408a47244b3': 'jacket',
  '59139c2186f77411564f8e42': 'pc-block',
  '578f879c24597735401e6bc6': 'cash-register', '64d116f41a9c6143a956127d': 'cash-register',
  '5909d36d86f774660f0bb900': 'grenade-box', '67adf4eb110ba15da90c6413': 'grenade-box',
  '5d6d2bb386f774785b07a77a': 'buried-barrel-cache',
  '5909e4b686f7747f5b744fa4': 'dead-scav', '67adf5752fc5ee84020a9940': 'dead-scav', '6582e6bb0c3b9823fe6d1840': 'dead-scav',
  '5909d24f86f77466f56e6855': 'medbag', '61aa1ead84ea0800645777fd': 'medbag',
  '6582e6d7b14c3f72eb071420': 'pmc-body',
  '5d6d2b5486f774785c2ba8ea': 'ground-cache',
  '5d6fd45b86f774317075ed43': 'technical-supply-crate', '67adf5f7adc1f43b0702b826': 'technical-supply-crate',
  '5909d45286f77465a8136dc6': 'wooden-ammo-box', '67adf4b81c58bd68b2002fec': 'wooden-ammo-box',
  '5909d4c186f7746ad34e805a': 'medcase',
  '5c052cea86f7746b2101e8d8': 'plastic-suitcase',
  '578f8782245977354405a1e3': 'safe', '66acff0a1d8e1083b303f5af': 'safe', '64d11702dd0cd96ab82c3280': 'safe',
  '5d6fd13186f77424ad2a8c69': 'ration-supply-crate',
  '5d6fe50986f77449d97f7463': 'medical-supply-crate',
  '658420d8085fea07e674cdb6': 'civilian-body',
  '6582e6c6edf14c4c6023adf2': 'lab-technician-body',
  '5d07b91b86f7745a077a9432': 'shturmans-stash',
}

export const lootContainerKindOfId = (id: string | undefined): LootContainerKind | undefined => id ? KIND_OF_CONTAINER[id] : undefined

/** The kind of a container's point: the adapter keeps the container's id in `meta`. */
export const lootContainerKindOf = (marker: Pick<MapMarker, 'meta'>) => lootContainerKindOfId(marker.meta)

/** The name a point of this container shows, in Russian as the adapter's other titles. */
export const lootContainerTitle = (id: string | undefined) => {
  const kind = lootContainerKindOfId(id)
  return LOOT_CONTAINER_KINDS.find((entry) => entry.kind === kind)?.ru
}
