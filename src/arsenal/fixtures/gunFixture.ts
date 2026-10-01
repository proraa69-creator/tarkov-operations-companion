/**
 * Offline fixture shaped exactly like tarkov.dev GraphQL answers to GUNS_QUERY / MODS_QUERY / AMMO_QUERY
 * (src/arsenal/gunQueries.ts). Used by unit tests and the Playwright screenshots — the numbers are plausible, not live.
 */
type Lang = 'ru' | 'en'
const id = (n: number) => `5f${n.toString(16).padStart(22, '0')}`
const asset = (name: string) => `https://assets.tarkov.dev/${name}`
const name = (lang: Lang, ru: string, en: string) => lang === 'ru' ? ru : en

export const FX = {
  m4: id(1), ak: id(2), mp7: id(3), glock: id(4), m700: id(5),
  grip: id(10), gripErgo: id(11), mag30: id(12), mag60: id(13), upper: id(14), barrel145: id(15), barrel105: id(16),
  flashHider: id(17), suppressor: id(18), gasLow: id(19), gasA2: id(20), handguard: id(21), handguardSmr: id(22),
  buffer: id(23), stockM4: id(24), stockCtr: id(25), charge: id(26), chargeRaptor: id(27), sightRear: id(28),
  holo: id(29), foregrip: id(30), mount: id(31), akMag: id(32), akMuzzle: id(33), akStock: id(34), mp7Mag: id(35), glockMag: id(36), m700Mag: id(37),
  m855: id(50), m855a1: id(51), m995: id(52), warmageddon: id(53), ps545: id(54), bs545: id(55),
  preset: id(90),
}

const flea = (price: number) => ({ priceRUB: price, vendor: { name: 'Барахолка', normalizedName: 'flea-market' } })
const trader = (price: number, key: string, label: string, level: number) => ({ priceRUB: price, vendor: { name: label, normalizedName: key, minTraderLevel: level } })
const slot = (nameId: string, label: string, allowed: string[], required = false) => ({ id: `${nameId}-slot`, name: label, nameId, required, filters: { allowedItems: allowed.map((item) => ({ id: item })) } })

export function gunsPayload(lang: Lang = 'ru') {
  const slotName = (ru: string, en: string) => name(lang, ru, en)
  return { data: { items: [
    {
      id: FX.m4, name: name(lang, 'Штурмовая винтовка Colt M4A1 5.56x45', 'Colt M4A1 5.56x45 assault rifle'), shortName: 'M4A1', iconLink: asset('m4-icon.webp'), image512pxLink: asset('m4-512.webp'), weight: 0.8, types: ['gun', 'wearable'],
      category: { name: name(lang, 'Штурмовая винтовка', 'Assault rifle'), normalizedName: 'assault-rifle' }, conflictingItems: [],
      buyFor: [flea(34_000), trader(29_500, 'peacekeeper', 'Миротворец', 2)],
      properties: {
        __typename: 'ItemPropertiesWeapon', caliber: 'Caliber556x45NATO', fireRate: 800, ergonomics: 50, recoilVertical: 56, recoilHorizontal: 220, centerOfImpact: 0.1,
        defaultAmmo: { id: FX.m855 },
        defaultPreset: { id: FX.preset, name: 'Colt M4A1 5.56x45 Default', image512pxLink: asset('m4-default-512.webp'), containsItems: [FX.m4, FX.grip, FX.mag30, FX.upper, FX.barrel145, FX.flashHider, FX.gasLow, FX.handguard, FX.sightRear, FX.buffer, FX.stockM4, FX.charge].map((item) => ({ item: { id: item }, count: 1 })) },
        slots: [
          slot('mod_pistol_grip', slotName('Пистолетная рукоятка', 'Pistol grip'), [FX.grip, FX.gripErgo]),
          slot('mod_magazine', slotName('Магазин', 'Magazine'), [FX.mag30, FX.mag60], true),
          slot('mod_reciever', slotName('Ресивер', 'Receiver'), [FX.upper], true),
          slot('mod_stock', slotName('Приклад', 'Stock'), [FX.buffer]),
          slot('mod_charge', slotName('Рукоятка взведения', 'Charging handle'), [FX.charge, FX.chargeRaptor]),
        ],
      },
    },
    {
      id: FX.ak, name: name(lang, 'Автомат Калашникова АК-74Н 5.45x39', 'Kalashnikov AK-74N 5.45x39 assault rifle'), shortName: 'AK-74N', iconLink: asset('ak-icon.webp'), image512pxLink: asset('ak-512.webp'), weight: 2.9, types: ['gun'],
      category: { name: name(lang, 'Штурмовая винтовка', 'Assault rifle'), normalizedName: 'assault-rifle' }, conflictingItems: [], buyFor: [flea(27_000), trader(22_800, 'prapor', 'Прапор', 1)],
      properties: { __typename: 'ItemPropertiesWeapon', caliber: 'Caliber545x39', fireRate: 650, ergonomics: 40, recoilVertical: 145, recoilHorizontal: 300, centerOfImpact: 0.12, defaultAmmo: { id: FX.ps545 },
        defaultPreset: { id: id(91), name: 'AK-74N Default', image512pxLink: asset('ak-default-512.webp'), containsItems: [{ item: { id: FX.akMag }, count: 1 }, { item: { id: FX.akMuzzle }, count: 1 }] },
        slots: [slot('mod_magazine', slotName('Магазин', 'Magazine'), [FX.akMag], true), slot('mod_muzzle', slotName('Дульное устройство', 'Muzzle'), [FX.akMuzzle]), slot('mod_stock', slotName('Приклад', 'Stock'), [FX.akStock])] },
    },
    {
      id: FX.mp7, name: name(lang, 'Пистолет-пулемёт HK MP7A1 4.6x30', 'HK MP7A1 4.6x30 submachine gun'), shortName: 'MP7A1', iconLink: asset('mp7-icon.webp'), weight: 1.2, types: ['gun'],
      category: { name: name(lang, 'Пистолет-пулемёт', 'Submachine gun'), normalizedName: 'smg' }, conflictingItems: [], buyFor: [flea(41_000)],
      properties: { __typename: 'ItemPropertiesWeapon', caliber: 'Caliber46x30', fireRate: 950, ergonomics: 68, recoilVertical: 47, recoilHorizontal: 150, defaultAmmo: null, defaultPreset: null, slots: [slot('mod_magazine', slotName('Магазин', 'Magazine'), [FX.mp7Mag], true)] },
    },
    {
      id: FX.glock, name: name(lang, 'Пистолет Glock 17 9x19', 'Glock 17 9x19 pistol'), shortName: 'Glock 17', iconLink: asset('glock-icon.webp'), weight: 0.3, types: ['gun'],
      category: { name: name(lang, 'Пистолет', 'Handgun'), normalizedName: 'handgun' }, conflictingItems: [], buyFor: [flea(18_000), trader(14_200, 'peacekeeper', 'Миротворец', 1)],
      properties: { __typename: 'ItemPropertiesWeapon', caliber: 'Caliber9x19PARA', fireRate: 450, ergonomics: 82, recoilVertical: 304, recoilHorizontal: 263, slots: [slot('mod_magazine', slotName('Магазин', 'Magazine'), [FX.glockMag], true)] },
    },
    {
      id: FX.m700, name: name(lang, 'Снайперская винтовка Remington Model 700 7.62x51', 'Remington Model 700 7.62x51 bolt-action sniper rifle'), shortName: 'M700', iconLink: asset('m700-icon.webp'), weight: 3.7, types: ['gun'],
      category: { name: name(lang, 'Снайперская винтовка', 'Sniper rifle'), normalizedName: 'sniper-rifle' }, conflictingItems: [], buyFor: [trader(49_000, 'jaeger', 'Егерь', 2)],
      properties: { __typename: 'ItemPropertiesWeapon', caliber: 'Caliber762x51', fireRate: 30, ergonomics: 42, recoilVertical: 362, recoilHorizontal: 333, slots: [slot('mod_magazine', slotName('Магазин', 'Magazine'), [FX.m700Mag])] },
    },
    // A preset is also type gun — must be filtered out.
    { id: FX.preset, name: 'Colt M4A1 5.56x45 Default', shortName: 'M4A1 Default', types: ['gun', 'preset'], properties: { __typename: 'ItemPropertiesPreset' } },
  ] } }
}

interface ModSpec { id: string; ru: string; en: string; short: string; ergo: number; recoil: number; acc?: number; weight: number; offers: unknown[]; slots?: unknown[]; conflicts?: string[]; noFlea?: boolean; coi?: number; capacity?: number; kind?: string }

function modSpecs(lang: Lang): ModSpec[] {
  const s = (ru: string, en: string) => name(lang, ru, en)
  return [
    { id: FX.grip, ru: 'Пистолетная рукоятка Colt A2 для AR-15', en: 'AR-15 Colt A2 pistol grip', short: 'A2', ergo: 6, recoil: 0, weight: 0.067, offers: [flea(2_100), trader(1_650, 'peacekeeper', 'Миротворец', 1)] },
    { id: FX.gripErgo, ru: 'Пистолетная рукоятка Ergo F93 Pro для AR-15', en: 'AR-15 Ergo F93 Pro pistol grip', short: 'F93', ergo: 14, recoil: 0, weight: 0.097, offers: [flea(6_800), trader(5_900, 'mechanic', 'Механик', 2)] },
    { id: FX.mag30, ru: 'Магазин 5.56x45 STANAG на 30 патронов', en: '5.56x45 STANAG 30-round magazine', short: 'STANAG', ergo: -2, recoil: 0, weight: 0.117, capacity: 30, offers: [flea(3_900), trader(3_100, 'peacekeeper', 'Миротворец', 1)], kind: 'magazine' },
    { id: FX.mag60, ru: 'Магазин 5.56x45 Magpul PMAG D-60 на 60 патронов', en: '5.56x45 Magpul PMAG D-60 60-round magazine', short: 'D-60', ergo: -12, recoil: 0, weight: 0.38, capacity: 60, offers: [flea(31_000), trader(36_500, 'peacekeeper', 'Миротворец', 3)], kind: 'magazine' },
    { id: FX.upper, ru: 'Верхний ресивер Colt M4A1 5.56x45', en: 'Colt M4A1 5.56x45 upper receiver', short: 'M4A1 upper', ergo: 4, recoil: 0, weight: 0.285, offers: [flea(9_400), trader(7_800, 'peacekeeper', 'Миротворец', 1)],
      slots: [
        slot('mod_barrel', s('Ствол', 'Barrel'), [FX.barrel145, FX.barrel105], true),
        slot('mod_handguard', s('Цевьё', 'Handguard'), [FX.handguard, FX.handguardSmr]),
        slot('mod_sight_rear', s('Целик', 'Rear sight'), [FX.sightRear]),
        slot('mod_scope', s('Прицел', 'Sight'), [FX.holo]),
      ] },
    { id: FX.barrel145, ru: 'Ствол 14.5" 5.56x45 для M4A1', en: 'M4A1 5.56x45 14.5 inch barrel', short: '14.5"', ergo: -11, recoil: 0, weight: 0.535, coi: 0.044, offers: [flea(12_500), trader(10_200, 'peacekeeper', 'Миротворец', 1)], kind: 'barrel',
      slots: [slot('mod_muzzle', s('Дульное устройство', 'Muzzle'), [FX.flashHider, FX.suppressor]), slot('mod_gas_block', s('Газоблок', 'Gas block'), [FX.gasLow, FX.gasA2], true)] },
    { id: FX.barrel105, ru: 'Ствол 10.5" 5.56x45 для AR-15', en: 'AR-15 5.56x45 10.5 inch barrel', short: '10.5"', ergo: -6, recoil: 0.05, weight: 0.4, coi: 0.07, offers: [flea(15_800)], kind: 'barrel',
      slots: [slot('mod_muzzle', s('Дульное устройство', 'Muzzle'), [FX.flashHider, FX.suppressor]), slot('mod_gas_block', s('Газоблок', 'Gas block'), [FX.gasLow], true)] },
    { id: FX.flashHider, ru: 'Пламегаситель Colt A2 5.56x45', en: 'Colt A2 5.56x45 flash hider', short: 'A2', ergo: -1, recoil: -0.05, weight: 0.05, offers: [flea(1_900), trader(1_400, 'peacekeeper', 'Миротворец', 1)] },
    { id: FX.suppressor, ru: 'Глушитель SureFire SOCOM556-RC2 5.56x45', en: 'SureFire SOCOM556-RC2 5.56x45 sound suppressor', short: 'RC2', ergo: -14, recoil: -0.12, acc: 0.02, weight: 0.5, noFlea: true, offers: [flea(52_000), trader(61_000, 'peacekeeper', 'Миротворец', 3)] },
    { id: FX.gasLow, ru: 'Газоблок низкопрофильный Colt M4', en: 'Colt M4 low profile gas block', short: 'Gas block', ergo: 0, recoil: -0.01, weight: 0.038, offers: [flea(2_400)] },
    { id: FX.gasA2, ru: 'Газоблок с мушкой Colt A2', en: 'Colt A2 gas block with front sight', short: 'A2 FSB', ergo: 1, recoil: 0, weight: 0.12, offers: [trader(3_600, 'mechanic', 'Механик', 1)], conflicts: [FX.handguardSmr] },
    { id: FX.handguard, ru: 'Цевьё Colt M4 стандартное', en: 'Colt M4 standard handguard', short: 'M4 HG', ergo: 4, recoil: -0.01, weight: 0.2, offers: [flea(4_200), trader(3_300, 'peacekeeper', 'Миротворец', 1)],
      slots: [slot('mod_foregrip', s('Тактическая рукоятка', 'Foregrip'), [FX.foregrip])] },
    { id: FX.handguardSmr, ru: 'Цевьё Geissele SMR Mk.16 13.5"', en: 'Geissele SMR Mk.16 13.5 inch handguard', short: 'SMR 13.5', ergo: 10, recoil: -0.03, weight: 0.36, offers: [flea(29_000), trader(26_700, 'peacekeeper', 'Миротворец', 4)],
      slots: [slot('mod_foregrip', s('Тактическая рукоятка', 'Foregrip'), [FX.foregrip]), slot('mod_mount_000', s('Крепление', 'Mount'), [FX.mount])] },
    { id: FX.buffer, ru: 'Буферная трубка AR-15 Colt', en: 'AR-15 Colt buffer tube', short: 'Buffer', ergo: 0, recoil: 0, weight: 0.08, offers: [flea(3_100), trader(2_500, 'peacekeeper', 'Миротворец', 1)],
      slots: [slot('mod_stock_000', s('Приклад', 'Stock'), [FX.stockM4, FX.stockCtr])] },
    { id: FX.stockM4, ru: 'Приклад Colt M4 для AR-15', en: 'AR-15 Colt M4 stock', short: 'M4 stock', ergo: 7, recoil: -0.12, weight: 0.17, offers: [flea(3_900), trader(2_900, 'peacekeeper', 'Миротворец', 1)] },
    { id: FX.stockCtr, ru: 'Приклад Magpul CTR для AR-15', en: 'AR-15 Magpul CTR stock', short: 'CTR', ergo: 12, recoil: -0.19, weight: 0.24, offers: [flea(11_200), trader(9_800, 'mechanic', 'Механик', 2)] },
    { id: FX.charge, ru: 'Рукоятка взведения Colt AR-15', en: 'AR-15 Colt charging handle', short: 'Colt CH', ergo: 0, recoil: 0, weight: 0.03, offers: [flea(1_500), trader(1_200, 'peacekeeper', 'Миротворец', 1)] },
    { id: FX.chargeRaptor, ru: 'Рукоятка взведения Radian Weapons Raptor', en: 'AR-15 Radian Weapons Raptor charging handle', short: 'Raptor', ergo: 7, recoil: 0, weight: 0.05, offers: [] },
    { id: FX.sightRear, ru: 'Целик складной KAC', en: 'KAC folding rear sight', short: 'KAC RS', ergo: 0, recoil: 0, weight: 0.08, offers: [flea(5_100)] },
    { id: FX.holo, ru: 'Голографический прицел EOTech EXPS3', en: 'EOTech EXPS3 holographic sight', short: 'EXPS3', ergo: -1, recoil: 0, weight: 0.32, offers: [flea(38_000), trader(33_400, 'peacekeeper', 'Миротворец', 3)] },
    { id: FX.foregrip, ru: 'Тактическая рукоятка Magpul AFG', en: 'Magpul AFG tactical grip', short: 'AFG', ergo: 3, recoil: -0.035, weight: 0.05, offers: [flea(14_600), trader(12_900, 'mechanic', 'Механик', 2)] },
    { id: FX.mount, ru: 'Крепление Magpul M-LOK', en: 'Magpul M-LOK mount', short: 'M-LOK', ergo: 0, recoil: 0, weight: 0.03, offers: [flea(2_000)] },
    { id: FX.akMag, ru: 'Магазин 5.45x39 6L23 на 30 патронов', en: '5.45x39 6L23 30-round magazine', short: '6L23', ergo: -3, recoil: 0, weight: 0.23, capacity: 30, offers: [flea(2_600), trader(2_100, 'prapor', 'Прапор', 1)] },
    { id: FX.akMuzzle, ru: 'Дульный тормоз-компенсатор 6П20', en: 'AK-74 6P20 muzzle brake', short: '6P20', ergo: -1, recoil: -0.08, weight: 0.05, offers: [flea(1_800)] },
    { id: FX.akStock, ru: 'Приклад АК-74 полимерный', en: 'AK-74 polymer stock', short: 'AK stock', ergo: 8, recoil: -0.22, weight: 0.34, offers: [flea(3_300), trader(2_800, 'prapor', 'Прапор', 1)] },
    { id: FX.mp7Mag, ru: 'Магазин 4.6x30 MP7 на 30 патронов', en: 'MP7 4.6x30 30-round magazine', short: 'MP7 30', ergo: -1, recoil: 0, weight: 0.11, offers: [flea(6_400)] },
    { id: FX.glockMag, ru: 'Магазин 9x19 Glock на 17 патронов', en: 'Glock 9x19 17-round magazine', short: 'G17 mag', ergo: -1, recoil: 0, weight: 0.07, offers: [flea(2_900)] },
    { id: FX.m700Mag, ru: 'Магазин M700 7.62x51 на 10 патронов', en: 'M700 7.62x51 10-round magazine', short: 'M700 mag', ergo: -2, recoil: 0, weight: 0.12, offers: [flea(7_900)] },
  ]
}

export function modsPayload(lang: Lang = 'ru') {
  return { data: { items: modSpecs(lang).map((mod) => ({
    id: mod.id, name: name(lang, mod.ru, mod.en), shortName: mod.short, iconLink: asset(`${mod.short}-icon.webp`), weight: mod.weight,
    types: ['mods', ...(mod.noFlea ? ['noFlea'] : [])],
    accuracyModifier: mod.acc ?? 0, recoilModifier: mod.recoil, ergonomicsModifier: mod.ergo,
    category: { name: mod.kind ?? 'mod', normalizedName: mod.kind ?? 'mod' },
    conflictingItems: (mod.conflicts ?? []).map((item) => ({ id: item })),
    buyFor: mod.offers,
    properties: {
      __typename: mod.kind === 'barrel' ? 'ItemPropertiesBarrel' : mod.kind === 'magazine' ? 'ItemPropertiesMagazine' : 'ItemPropertiesWeaponMod',
      ergonomics: mod.ergo, recoilModifier: mod.recoil, accuracyModifier: mod.acc ?? 0, slots: mod.slots ?? [],
      ...(mod.coi !== undefined ? { centerOfImpact: mod.coi } : {}), ...(mod.capacity ? { capacity: mod.capacity } : {}),
    },
  })) } }
}

export function ammoPayload(lang: Lang = 'ru') {
  const round = (ammoId: string, ru: string, en: string, short: string, caliber: string, damage: number, pen: number, armor: number, frag: number, speed: number, recoil: number, offers: unknown[], noFlea = false) => ({
    item: { id: ammoId, name: name(lang, ru, en), shortName: short, iconLink: asset(`${short}-icon.webp`), types: ['ammo', ...(noFlea ? ['noFlea'] : [])], buyFor: offers },
    caliber, damage, armorDamage: armor, penetrationPower: pen, fragmentationChance: frag, initialSpeed: speed, projectileCount: 1, recoilModifier: recoil, accuracyModifier: 0, tracer: false,
  })
  return { data: { ammo: [
    round(FX.m855, 'Патрон 5.56x45 M855', '5.56x45mm M855', 'M855', 'Caliber556x45NATO', 54, 31, 46, 0.4, 922, 0, [flea(420), trader(360, 'peacekeeper', 'Миротворец', 1)]),
    round(FX.m855a1, 'Патрон 5.56x45 M855A1', '5.56x45mm M855A1', 'M855A1', 'Caliber556x45NATO', 49, 44, 52, 0.34, 945, 0.02, [flea(1_150), trader(980, 'peacekeeper', 'Миротворец', 3)]),
    round(FX.m995, 'Патрон 5.56x45 M995', '5.56x45mm M995', 'M995', 'Caliber556x45NATO', 42, 53, 58, 0.32, 1013, 0.04, [trader(1_640, 'peacekeeper', 'Миротворец', 4)], true),
    round(FX.warmageddon, 'Патрон 5.56x45 Warmageddon', '5.56x45mm Warmageddon', 'Warm.', 'Caliber556x45NATO', 88, 3, 1, 0.9, 936, 0, [flea(380)]),
    round(FX.ps545, 'Патрон 5.45x39 ПС гс', '5.45x39mm PS gs', 'PS', 'Caliber545x39', 50, 28, 40, 0.4, 890, 0, [flea(210), trader(160, 'prapor', 'Прапор', 1)]),
    round(FX.bs545, 'Патрон 5.45x39 БС гс', '5.45x39mm BS gs', 'BS', 'Caliber545x39', 40, 57, 63, 0.16, 830, 0.05, [trader(1_280, 'prapor', 'Прапор', 4)], true),
  ] } }
}
