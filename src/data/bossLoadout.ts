/**
 * Gallery info blocks: health per body part, the weapons a boss can carry and the main valuable loot he drops.
 * Only names and item ids are kept here; the pictures come at run time from the item catalog the app already
 * loads from tarkov.dev (see resolveBossItem). An item that is not in the catalog (offline, renamed) is shown
 * as a named tile without a picture.
 *
 * Checked in September 2026 against the EFT wiki, tarkov.dev and boss guides (HP per part: game values, same
 * totals as BOSS_INFO.health). Loot lists name the main expensive possible drops, not guaranteed ones.
 */
import type { Item } from '../domain/types'
import type { Bilingual } from './bossInfo'

/** Head, thorax, stomach, left arm, right arm, left leg, right leg. */
export type BodyHealth = readonly [number, number, number, number, number, number, number]

export interface BossItemRef {
  /** tarkov.dev item ids tried first (the base weapon, not a preset). */
  ids?: string[]
  /** Fragment of tarkov.dev's normalizedName, tried when no id matches. */
  slug?: string
  name: Bilingual
}

export interface BossLoadout {
  body?: BodyHealth
  weapons?: BossItemRef[]
  loot?: BossItemRef[]
  /** A short remark under the blocks (what can't be looted and similar). */
  note?: Bilingual
}

const item = (ru: string, en: string, slug?: string, ...ids: string[]): BossItemRef => ({ name: { ru, en }, slug, ids: ids.length ? ids : undefined })

// Weapons and loot used by several bosses
const LABS_KEYCARD = item('Ключ-карта лаборатории', 'Labs access keycard', 'terragroup-labs-access-keycard', '5c94bbff86f7747ee735c08f')
const BITCOIN = item('Физический биткоин', 'Physical Bitcoin', 'physical-bitcoin', '59faff1d86f7746c51718c9c')
const LEDX = item('LEDX', 'LEDX', 'ledx-skin-transilluminator', '5c0530ee86f774697952d952')
const GPU = item('Видеокарта', 'Graphics card', 'graphics-card', '57347ca924597744596b4e71')
const SVDS = item('СВДС', 'SVDS', 'svds-762x54r-sniper-rifle', '5c46fbd72e2216398b5a8c9c')
const SR1MP = item('СР-1МП «Гюрза»', 'SR-1MP Gyurza', 'sr-1mp-gyurza-9x21-pistol', '59f98b4986f7746f546d2cef')
const SAIGA12K = item('Сайга-12К', 'Saiga-12K', 'saiga-12ga-ver10-12x76-shotgun', '576165642459773c7a400233')
const M870 = item('Remington 870', 'Remington 870', 'remington-model-870-12ga-pump-action-shotgun', '5a7828548dc32e5a9c28b516')
const TT = item('ТТ-33', 'TT-33', 'tt-33-762x25-tt-pistol', '571a12c42459771f627b58a0')
const GOLDEN_TT = item('Золотой ТТ', 'Golden TT', 'tt-33-762x25-tt-pistol-golden', '5b3b713c5acfc4330140bd8d')

export const BOSS_LOADOUT: Record<string, BossLoadout> = {
  reshala: {
    body: [62, 145, 125, 100, 100, 110, 110],
    weapons: [GOLDEN_TT, item('АК-101', 'AK-101', 'kalashnikov-ak-101', '5ac66cb05acfc40198510a10'), item('АК-102', 'AK-102', 'kalashnikov-ak-102', '5ac66d015acfc400180ae6e4'), item('FN P90', 'FN P90', 'fn-p90', '5cc82d76e24e8d00134b4b83'), item('SIG MPX', 'SIG MPX', 'sig-mpx', '58948c8e86f77409493f7266')],
    loot: [GOLDEN_TT, BITCOIN, LABS_KEYCARD],
  },
  partisan: {
    body: [80, 220, 190, 110, 110, 120, 120],
    weapons: [item('АК-74М', 'AK-74M', 'kalashnikov-ak-74m', '5ac4cd105acfc40016339859'), item('ГП-25', 'GP-25', 'gp-25'), item('МР-133', 'MP-133', 'mp-133-12ga-pump-action-shotgun', '54491c4f4bdc2db1078b4568'), item('МР-153', 'MP-153', 'mp-153-12ga-semi-automatic-shotgun', '56dee2bdd2720bc8328b4567'), item('Граната Ф-1', 'F-1 grenade', 'f-1-hand-grenade', '5710c24ad2720bc3458b45a3')],
    loot: [item('Сумка Партизана', 'Partisan’s bag', 'partisans-bag'), item('Выстрел ВОГ-25', 'VOG-25 grenade', 'vog-25'), LEDX],
  },
  'goon-1': {
    body: [70, 175, 150, 100, 100, 100, 100],
    weapons: [item('Aklys Defense RSASS', 'RSASS', 'aklys-defense-velociraptor', '5a367e5dc4a282000e49738f'), item('Colt M4A1', 'Colt M4A1', 'colt-m4a1-556x45-assault-rifle', '5447a9cd4bdc2dbd208b4567'), item('Beretta M9A3', 'Beretta M9A3', 'beretta-m9a3', '5cadc190ae921500103bb3b6')],
    loot: [item('Разгрузка THOR CRV', 'THOR Concealable Reinforced Vest', 'nfm-thor-concealable-reinforced-vest'), LABS_KEYCARD, GPU],
  },
  'goon-2': {
    body: [80, 220, 220, 150, 150, 150, 150],
    weapons: [item('SIG MCX SPEAR', 'SIG MCX SPEAR', 'sig-mcx-spear', '65290f395ae2ae97b80fdf2d'), item('Glock 17', 'Glock 17', 'glock-17-9x19-pistol', '5a7ae0c351dfba0017554310')],
    loot: [item('Маска «Death Knight»', 'Death Knight mask', 'death-knight-mask', '62963c18dbc8ab5f0d382d0b'), item('Crye Precision CPC (Goons Edition)', 'Crye Precision CPC (Goons Edition)', 'crye-precision-cpc-plate-carrier-goons-edition'), LABS_KEYCARD],
  },
  'goon-3': {
    body: [70, 220, 200, 110, 110, 100, 100],
    weapons: [item('Milkor M32A1', 'Milkor M32A1', 'milkor-m32a1', '6275303a9f372d6ea97f9ec7'), item('FN GL40 Mk.2', 'FN GL40 Mk.2', 'fn-gl40-mk2', '5e81ebcd8e146c7080625e15'), item('U.S. Ordnance M60E6', 'M60E6', 'us-ordnance-m60e6'), item('SIG MCX .300 BLK', 'SIG MCX .300 BLK', 'sig-mcx-300-blk', '5fbcc1d9016cce60e8341ab3'), M870, item('Colt M45A1', 'Colt M45A1', 'colt-m45a1', '5f36a0e5fbf956000b716b65')],
    loot: [item('Граната M433 HEDP', 'M433 HEDP grenade', '40x46mm-m433-hedp'), LABS_KEYCARD, BITCOIN],
  },
  shturman: {
    body: [62, 180, 150, 100, 100, 110, 110],
    weapons: [SVDS, item('АК-105', 'AK-105', 'kalashnikov-ak-105', '5ac66d9b5acfc4001633997a')],
    loot: [item('Ключ от схрона Штурмана', 'Shturman’s stash key', 'shturmans-stash-key', '5d08d21286f774736e7c94c3'), SVDS, GPU, LABS_KEYCARD],
  },
  sanitar: {
    body: [70, 360, 140, 120, 120, 230, 230],
    weapons: [item('АПС', 'APS', 'stechkin-aps', '5a17f98cfcdbcb0980087290'), item('«Кедр-Б»', 'Kedr-B', 'pp-91-01-kedr-b', '57f3c6bd24597738e730fa2f'), item('СКС', 'SKS', 'toz-simonov-sks', '574d967124597745970e7c94'), M870, item('ВСС «Винторез»', 'VSS Vintorez', 'vss-vintorez', '57838ad32459774a17445cd2')],
    loot: [LEDX, item('Хирургический набор CMS', 'CMS surgical kit', 'cms-surgical-kit', '5d02778e86f774203e7dedbe'), item('Surv12', 'Surv12 field surgical kit', 'surv12-field-surgical-kit', '5d02797c86f774203f38e30a'), item('Аптечка «Гризли»', 'Grizzly medical kit', 'grizzly-medical-kit', '590c657e86f77412b013051d'), item('Пропитал', 'Propital', 'propital', '5c0e530286f7747fa1419862')],
  },
  killa: {
    body: [70, 210, 170, 100, 100, 120, 120],
    weapons: [item('РПК-16', 'RPK-16', 'rpk-16', '5beed0f50db834001c062b12'), TT],
    loot: [item('Шлем «Маска-1Щ» (Killa)', 'Maska-1SCh helmet (Killa Edition)', 'maska-1shch-bulletproof-helmet-killa', '5c0e874186f7745dc7616606'), item('Бронежилет 6Б13 М (Killa)', '6B13 M assault armor (Killa Edition)', '6b13-m-assault-armor-killa'), item('Ключ от магазина KIBA', 'KIBA Arms outer door key', 'kiba-arms-outer-door'), LABS_KEYCARD, BITCOIN],
  },
  tagilla: {
    body: [100, 320, 260, 130, 130, 140, 140],
    weapons: [SAIGA12K, item('МР-155', 'MP-155', 'mp-155-ultima', '606dae0ab0e443224b421bb7'), item('АКС-74УН', 'AKS-74UN', 'kalashnikov-aks-74un', '583990e32459771419544dd2')],
    loot: [item('Сварочная маска «Gorilla»', 'Tagilla’s welding mask “Gorilla”', 'tagillas-welding-mask-gorilla', '60a7ad2a2198820d95707a2e'), item('Сварочная маска «УБЕЙ»', 'Tagilla’s welding mask “UBEY”', 'tagillas-welding-mask-ubey', '60a7ad3a0c5cb24b0134664a'), LABS_KEYCARD],
    note: { ru: 'Кувалда не лутается.', en: 'The sledgehammer can’t be looted.' },
  },
  'tagilla-2': {
    body: [105, 360, 280, 140, 140, 140, 140],
    weapons: [SAIGA12K, item('АК-12', 'AK-12', 'kalashnikov-ak-12')],
    note: { ru: 'Секира и маска с него не снимаются.', en: 'His Labrys and mask can’t be looted.' },
  },
  glukhar: {
    body: [70, 220, 140, 145, 145, 145, 145],
    weapons: [item('АШ-12', 'ASh-12', 'ash-12', '5cadfbf7ae92152ac412eeef'), item('Springfield M1A', 'Springfield M1A', 'springfield-armory-m1a', '5aafa857e5b5b00018480968'), item('ПП-19 «Витязь»', 'PP-19-01 Vityaz', 'pp-19-01-vityaz', '59984ab886f7743e98271174')],
    loot: [item('АШ-12', 'ASh-12', 'ash-12', '5cadfbf7ae92152ac412eeef'), item('Аптечка IFAK', 'IFAK', 'ifak-individual-first-aid-kit', '590c678286f77426c9660122'), item('Карта минного поля Резерва', 'Reserve minefield map', 'reserve-minefield-map'), LABS_KEYCARD],
  },
  zryachiy: {
    body: [175, 450, 270, 190, 190, 190, 190],
    weapons: [SVDS, item('АКС-74У', 'AKS-74U', 'kalashnikov-aks-74u', '57dc2fa62459775949412633'), SR1MP],
    loot: [SVDS, item('Балаклава Зрячего', 'Zryachiy’s balaclava', 'zryachiys-balaclava'), item('Пояс Azimut «Хамелеон»', 'Azimut SS Khamelion chest harness', 'azimut-ss-khamelion')],
  },
  rogue: {
    weapons: [item('Colt M4A1', 'Colt M4A1', 'colt-m4a1-556x45-assault-rifle', '5447a9cd4bdc2dbd208b4567'), item('HK 416A5', 'HK 416A5', 'hk-416a5', '5bb2475ed4351e00853264e3'), item('HK G28', 'HK G28', 'hk-g28'), item('ПКП «Печенег»', 'PKP Pecheneg', 'kalashnikov-pkp', '64ca3d3954fc657e230529cc')],
    loot: [item('Патроны M61', 'M61 rounds', '762x51mm-m61'), item('Шлем Ops-Core FAST MT', 'Ops-Core FAST MT helmet', 'ops-core-fast-mt-super-high-cut-helmet'), GPU],
  },
  kaban: {
    body: [85, 355, 260, 150, 150, 150, 150],
    weapons: [item('ПКП «Печенег»', 'PKP Pecheneg', 'kalashnikov-pkp', '64ca3d3954fc657e230529cc'), item('U.S. Ordnance M60E4', 'M60E4', 'us-ordnance-m60e4'), SR1MP],
    loot: [item('ПКП «Печенег»', 'PKP Pecheneg', 'kalashnikov-pkp', '64ca3d3954fc657e230529cc'), item('Ключ от закрытой секции автосалона', 'Car dealership closed section key', 'car-dealership-closed-section-key'), LABS_KEYCARD],
  },
  kollontay: {
    body: [65, 300, 150, 150, 150, 120, 120],
    weapons: [item('ПП-9 «Клин»', 'PP-9 Klin', 'pp-9-klin', '57f4c844245977379d5c14d1'), item('ПП-91 «Кедр»', 'PP-91 Kedr', 'pp-91-kedr', '57d14d2524597714373db789'), item('КС-23М', 'KS-23M', 'ks-23m', '5e848cc2988a8701445df1e8'), item('РПД', 'RPD', 'degtyarev-rpd')],
    loot: [item('Дубинка ПР-Таран', 'PR-Taran police baton', 'pr-taran')],
  },
  'black-division': {
    weapons: [item('HK 416A5', 'HK 416A5', 'hk-416a5', '5bb2475ed4351e00853264e3'), item('SIG MCX SPEAR', 'SIG MCX SPEAR', 'sig-mcx-spear', '65290f395ae2ae97b80fdf2d')],
    loot: [item('Противогаз Avon', 'Avon mask', 'avon'), item('ПНВ L3Harris AN/PVS-31', 'L3Harris AN/PVS-31', 'an-pvs-31'), LEDX],
  },
  wadge: {
    body: [70, 170, 140, 120, 120, 130, 130],
    weapons: [item('HK MP7A1', 'HK MP7A1', 'hk-mp7a1', '5ba26383d4351e00334c93d9')],
    loot: [item('Spiritus Systems LV-119', 'Spiritus Systems LV-119', 'spiritus-systems-lv-119'), item('Евро', 'Euros', 'euros', '569668774bdc2da2298b4568')],
  },
}

export function bossLoadout(key: string): BossLoadout | undefined {
  return BOSS_LOADOUT[key]
}

/**
 * Finds the catalog item for a boss weapon or drop: by id, then by tarkov.dev's normalizedName (exact, then the
 * shortest name containing the slug, so the bare weapon wins over its presets and variants). For weapons
 * (`gun`) a firearm wins over parts that carry the weapon's name (an MPX handguard, an RPK-16 drum).
 */
export function resolveBossItem(ref: BossItemRef, items: readonly Item[], index?: Map<string, Item>, gun = false): Item | undefined {
  for (const id of ref.ids ?? []) {
    const hit = index ? index.get(id) : items.find((entry) => entry.id === id)
    if (hit) return hit
  }
  if (!ref.slug) return undefined
  let best: Item | undefined, bestScore = Infinity
  for (const entry of items) {
    const name = entry.normalizedName
    if (!name || !name.includes(ref.slug)) continue
    if (name === ref.slug) return entry
    const score = name.length + (gun && !entry.types?.includes('gun') ? 1000 : 0)
    if (score < bestScore) { best = entry; bestScore = score }
  }
  return best
}
