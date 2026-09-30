/**
 * Gallery descriptions of the owner's boss models: who they are, HP, weapons and notable loot (RU + EN).
 * Maps are NOT stored here: the Gallery shows the owner's map list (MAP_BOSSES in bossFigures.ts).
 *
 * Checked in September 2026 against the EFT wiki (escapefromtarkov.fandom.com), tarkov.dev and boss guides
 * (see `sources`). HP totals match tarkov.dev (STATIC_BOSSES in bosses.ts). Anything that could not be
 * confirmed is left out rather than guessed. Loot lists name notable possible drops, not guaranteed ones,
 * unless marked «всегда» / "always". Ancient bosses are the owner's medieval versions: flavour text only.
 */
export interface Bilingual { ru: string; en: string }

export type BossSection = 'main' | 'ancient'

export interface BossDetails {
  /** Short role line (cards and the viewer head). */
  role: Bilingual
  /** One or two sentences: who this is. */
  about: Bilingual
  /** Total HP of all body parts. */
  health?: number
  weapons?: Bilingual
  loot?: Bilingual
  /** Ancient versions: the boss key the model is styled after. */
  basedOn?: string
  sources?: string[]
}

const WIKI = 'https://escapefromtarkov.fandom.com/wiki/'
const DEV = 'https://tarkov.dev/boss/'

/** Gallery sections in display order (the owner's list order). */
export const GALLERY_BOSS_KEYS: Record<BossSection, string[]> = {
  main: [
    'reshala', 'partisan', 'goon-1', 'goon-2', 'goon-3', 'shturman', 'sanitar', 'killa', 'tagilla', 'tagilla-2',
    'glukhar', 'zryachiy', 'rogue', 'kaban', 'kollontay', 'black-division', 'wadge', 'military',
  ],
  ancient: [
    'killa-knight', 'tagilla-knight', 'tagilla-2-knight', 'reshala-knight', 'sanitar-knight', 'dark-knight', 'zryachiy-archer', 'goon-bow', 'goon-axe',
    'black-division-old', 'ancient-soldier',
  ],
}

const GOONS: Bilingual = {
  ru: 'Кочевники — отряд из трёх боссов (бывшие USEC), которые командуют Отступниками.',
  en: 'The Goons are a squad of three bosses (ex-USEC) who command the Rogues.',
}

export const BOSS_INFO: Record<string, BossDetails> = {
  reshala: {
    role: { ru: 'Главарь диких', en: 'Scav boss' },
    about: {
      ru: 'Лидер банды диких. Ходит с четырьмя охранниками; сам брони не носит — охрана экипирована заметно лучше него.',
      en: 'Leader of a Scav gang. Moves with four guards and wears no armour himself — his guards are far better equipped.',
    },
    health: 752,
    weapons: { ru: 'Золотой ТТ; основное — АК-101/АК-102, P90, UZI PRO или MPX', en: 'Golden TT; primary: AK-101/AK-102, P90, UZI PRO or MPX' },
    loot: { ru: 'Золотой ТТ, физический биткоин, ключ-карта лаборатории (редко)', en: 'Golden TT pistol, Physical Bitcoin, TerraGroup Labs keycard (rare)' },
    sources: [`${WIKI}Reshala`, `${DEV}reshala`, 'https://timesaver.gg/blog/tarkov-reshala-boss-guide'],
  },
  partisan: {
    role: { ru: 'Одиночка-диверсант', en: 'Lone saboteur' },
    about: {
      ru: 'Действует скрытно: заранее ставит растяжки и мины, активно бросает гранаты и может долго выслеживать цель по всей локации.',
      en: 'Works by stealth: sets tripwires and mines in advance, throws grenades a lot and can track a target across the whole map.',
    },
    health: 950,
    weapons: { ru: 'АК-74М с подствольным ГП-25, МР-133/МР-153; гранаты Ф-1, РГД, РГО', en: 'AK-74M with a GP-25 underbarrel launcher, MP-133/MP-153; F-1, RGD and RGO grenades' },
    loot: { ru: 'Уникальный рюкзак «Сумка Партизана», выстрелы ВОГ-25, взрывчатка, медицина', en: 'Unique Partisan’s bag backpack, VOG-25 grenades, explosives, medical supplies' },
    sources: [`${WIKI}Partisan`, 'https://v-tarkov.ru/en/boss/partizan', 'https://www.tarkovhead.com/en/boss/regular/partisan'],
  },
  'goon-1': {
    role: { ru: 'Кочевники · снайпер', en: 'Goons · marksman' },
    about: {
      ru: `Марксман и радист отряда. Самый тихий из троицы: замечает цель первым и бьёт с дальней дистанции. ${GOONS.ru}`,
      en: `The squad’s marksman and radioman. The quietest of the three: spots targets first and shoots from long range. ${GOONS.en}`,
    },
    health: 795,
    weapons: { ru: 'Марксманская винтовка RSASS, M4A1', en: 'RSASS marksman rifle, M4A1' },
    loot: { ru: 'Оружие и снаряжение высокого класса; шанс ключ-карты лаборатории', en: 'High-tier rifles and gear; a chance of a TerraGroup Labs keycard' },
    sources: [`${WIKI}Birdeye`, `${WIKI}The_Goons`, `${DEV}birdeye`],
  },
  'goon-2': {
    role: { ru: 'Кочевники · командир', en: 'Goons · leader' },
    about: {
      ru: `Командир и штурмовик отряда: сближается и давит, пока снайпер и гренадёр прикрывают. Носит маску «Death Knight». ${GOONS.ru}`,
      en: `The squad’s leader and assaulter: closes in and pushes while the marksman and the grenadier cover him. Wears the Death Knight mask. ${GOONS.en}`,
    },
    health: 1120,
    weapons: { ru: 'SIG MCX SPEAR 6.8, Glock 17', en: 'SIG MCX SPEAR 6.8, Glock 17' },
    loot: { ru: 'Маска «Death Knight», бронежилет Crye Precision CPC в версии Кочевников; шанс ключ-карты лаборатории', en: 'Death Knight mask, Goons-edition Crye Precision CPC plate carrier; a chance of a Labs keycard' },
    sources: [`${WIKI}Knight`, `${WIKI}The_Goons`, `${DEV}knight`],
  },
  'goon-3': {
    role: { ru: 'Кочевники · гренадёр', en: 'Goons · grenadier' },
    about: {
      ru: `Тяжёлое вооружение отряда: гранатомётом выбивает из укрытий и агрессивно идёт на сближение. ${GOONS.ru}`,
      en: `The squad’s heavy weapons: flushes targets out of cover with a grenade launcher and pushes aggressively. ${GOONS.en}`,
    },
    health: 910,
    weapons: { ru: 'Гранатомёты M32A1 и FN40GL, M60, SIG MCX, Remington 870, M45A1', en: 'M32A1 and FN40GL grenade launchers, M60, SIG MCX, Remington 870, M45A1' },
    loot: { ru: 'Гранаты и стимуляторы; шанс ключей и ключ-карты лаборатории', en: 'Grenades and stims; a chance of keys and a Labs keycard' },
    sources: [`${WIKI}Big_Pipe`, 'https://v-tarkov.ru/en/boss/boss-bolshaya-trubka', `${DEV}big-pipe`],
  },
  shturman: {
    role: { ru: 'Главарь диких · стрелок', en: 'Scav boss · marksman' },
    about: {
      ru: 'Держит лесопилку вместе с охраной. Сам без брони, но отряд воюет на дальней дистанции и очень точно стреляет.',
      en: 'Holds the sawmill with his guards. Wears no armour, but the squad fights at long range and shoots very accurately.',
    },
    health: 812,
    weapons: { ru: 'СВДС, АК-105', en: 'SVDS, AK-105' },
    loot: { ru: 'Ключ от схрона Штурмана (всегда), СВДС; шанс видеокарты и ключ-карты лаборатории', en: 'Shturman’s stash key (always), SVDS; a chance of a Graphics card and a Labs keycard' },
    sources: [`${WIKI}Shturman`, `${DEV}shturman`, 'https://tarkovkit.com/en/guides/bosses/shturman'],
  },
  sanitar: {
    role: { ru: 'Главарь диких · медик', en: 'Scav boss · medic' },
    about: {
      ru: 'Ходит с тремя охранниками; лучший источник медицинского лута в игре. Очень живучий — почти втрое больше здоровья, чем у ЧВК.',
      en: 'Moves with three guards; the best source of medical loot in the game. Very tough — almost three times a PMC’s health.',
    },
    health: 1270,
    weapons: { ru: 'АПС, «Кедр-Б», Desert Eagle, СКС, Remington 870, иногда ВСС «Винторез»', en: 'APS, Kedr-B, Desert Eagle, SKS, Remington 870, sometimes a VSS Vintorez' },
    loot: { ru: 'Сумка Санитара с хирургическими наборами (CMS, Surv12), стимуляторы, аптечка «Гризли», ключи от помеченных комнат', en: 'Sanitar’s bag with surgical kits (CMS, Surv12), stims, Grizzly medical kit, marked room keys' },
    sources: [`${WIKI}Sanitar`, 'https://timesaver.gg/blog/tarkov-sanitar-boss-guide', `${DEV}sanitar`],
  },
  killa: {
    role: { ru: 'Боец-одиночка', en: 'Lone brawler' },
    about: {
      ru: 'Ходит без охраны: находит цель, давит огнём на подавление и идёт вперёд до конца. Старший брат Тагиллы.',
      en: 'Works alone: finds a target, suppresses it and keeps pushing until one of them is dead. Tagilla’s older brother.',
    },
    health: 890,
    weapons: { ru: 'РПК-16 или РПК с барабанным магазином, ТТ', en: 'RPK-16 or an RPK with a drum magazine, TT' },
    loot: { ru: 'Шлем «Маска-1Щ» и бронежилет 6Б13 М в версии Киллы, ключ от магазина KIBA, ключ-карты лаборатории, стимуляторы, биткоин', en: 'Killa’s Maska-1SCh helmet and 6B13 M armour, KIBA store key, Labs keycards, stims, Bitcoin' },
    sources: [`${WIKI}Killa`, `${DEV}killa`, 'https://eft.su/b/killa/en'],
  },
  tagilla: {
    role: { ru: 'Одиночка с кувалдой', en: 'Lone brute with a sledgehammer' },
    about: {
      ru: 'Младший брат Киллы. Ходит без охраны, носит сварочную маску и в ближнем бою добивает кувалдой.',
      en: 'Killa’s younger brother. Works alone, wears a welding mask and finishes fights with his sledgehammer.',
    },
    health: 1220,
    weapons: { ru: 'Кувалда (не лутается); на дистанции — «Сайга-12К» или МР-155', en: 'Sledgehammer (can’t be looted); at range a Saiga-12K or MP-155' },
    loot: { ru: 'Сварочная маска Тагиллы («Gorilla» и др.); в карманах — любые ключи и ключ-карты', en: 'Tagilla’s welding mask (“Gorilla” and others); any keys or keycards in his pockets' },
    sources: [`${WIKI}Tagilla`, `${DEV}tagilla`, 'https://tarkovkit.com/en/guides/bosses/tagilla'],
  },
  'tagilla-2': {
    role: { ru: 'Босс Лабиринта', en: 'Boss of the Labyrinth' },
    about: {
      ru: 'Босс Лабиринта — «теневая» версия Тагиллы: быстрее, тише и агрессивнее обычного. Не задевает растяжки, не получает урона от взрывов и может появиться в любой точке небольшой карты.',
      en: 'The Labyrinth’s boss, a “shadow” version of Tagilla: faster, quieter and more aggressive. Doesn’t set off tripwires, is immune to explosions and can turn up anywhere on the small map.',
    },
    health: 1305,
    weapons: { ru: 'Двуглавая секира Chained Labrys; «Сайга-12К» или АК-12', en: 'Chained Labrys double axe; Saiga-12K or AK-12' },
    loot: { ru: 'Секира и маска с него не снимаются', en: 'His Labrys and mask can’t be looted' },
    sources: [`${WIKI}Shadow_of_Tagilla`, `${DEV}shadow-of-tagilla`, 'https://mrsouer.com/eft/wiki/bosses/shadow-of-tagilla'],
  },
  glukhar: {
    role: { ru: 'Главарь с отрядом', en: 'Boss with a squad' },
    about: {
      ru: 'Ходит с шестью охранниками: разведчики, охрана и штурмовики — у каждой пары своё снаряжение и манера боя.',
      en: 'Moves with six guards — scouts, security and assaulters, each pair with its own gear and fighting style.',
    },
    health: 1010,
    weapons: { ru: 'АШ-12 (всегда); второе — M1A или ПП-19 «Витязь»', en: 'ASh-12 (always); secondary M1A or PP-19 Vityaz' },
    loot: { ru: 'АШ-12, аптечка IFAK, карта минного поля Резерва, любые ключи; шанс ключ-карты лаборатории', en: 'ASh-12, IFAK, Reserve minefield map, any keys; a chance of a Labs keycard' },
    sources: [`${WIKI}Glukhar`, `${DEV}glukhar`, 'https://timesaver.gg/blog/tarkov-glukhar-boss-guide'],
  },
  zryachiy: {
    role: { ru: 'Культист · страж маяка', en: 'Cultist · Lighthouse guardian' },
    about: {
      ru: 'Охраняет остров маяка и пропускает только тех, кого ждёт Смотритель: не трогает игроков с закодированным передатчиком DSP, пока его не спровоцируют. Часто сначала отстреливает конечности; двое последователей возрождаются, пока он жив.',
      en: 'Guards the Lighthouse island and lets through only those the Lightkeeper expects: leaves players with an encoded DSP transmitter alone unless provoked. Often shoots limbs first; his two followers respawn while he lives.',
    },
    health: 1655,
    weapons: { ru: 'СВДС, АКС-74У, пистолет СР-1МП «Гюрза»', en: 'SVDS, AKS-74U, SR-1MP Gyurza pistol' },
    loot: { ru: 'СВДС, балаклава Зрячего, пояс Azimut «Хамелеон»', en: 'SVDS, Zryachiy’s balaclava, Azimut Khamelion chest belt' },
    sources: [`${WIKI}Zryachiy`, `${DEV}zryachiy`, 'https://tarkov.dev/item/zryachiys-balaclava'],
  },
  rogue: {
    role: { ru: 'Фракция, не босс', en: 'A faction, not a boss' },
    about: {
      ru: 'Бывшие бойцы USEC, которыми командуют Кочевники. Держат укреплённые позиции со стационарными АГС и пулемётами.',
      en: 'Ex-USEC operators commanded by the Goons. Hold fortified positions with mounted AGS grenade launchers and machine guns.',
    },
    weapons: { ru: 'Точные винтовки M4/HK; стационарные АГС и ПКМ/ПКП', en: 'Accurate M4/HK rifles; mounted AGS, PKM/PKP' },
    loot: { ru: 'Винтовки 7.62×51, бронебойные патроны, тактические шлемы, бронежилеты 5–6 класса', en: '7.62×51 rifles, armour-piercing rounds, tactical helmets, class 5–6 armour' },
    sources: [`${WIKI}Rogues`, 'https://timesaver.gg/blog/tarkov-lighthouse-rogues-guide'],
  },
  kaban: {
    role: { ru: 'Главарь диких · пулемётчик', en: 'Scav boss · machine gunner' },
    about: {
      ru: 'Укрепился в автосалоне с большой охраной, включая снайперов на подходах. Брони не носит, зато давит длинными очередями.',
      en: 'Dug in at the car dealership with a large guard, snipers included. Wears no armour but suppresses with long bursts.',
    },
    health: 1300,
    weapons: { ru: 'ПКП «Печенег», иногда M60E4/M60E6; СР-1МП', en: 'PKP Pecheneg, sometimes an M60E4/M60E6; SR-1MP' },
    loot: { ru: 'ПКП, ключ от закрытой секции автосалона; шанс ключ-карты лаборатории', en: 'PKP, Car dealership closed section key; a chance of a Labs keycard' },
    sources: [`${WIKI}Kaban`, 'https://v-tarkov.ru/en/boss/boss-kaban', `${DEV}kaban`],
  },
  kollontay: {
    role: { ru: 'Главарь диких · силовик', en: 'Scav boss · enforcer' },
    about: {
      ru: 'Ходит с четырьмя охранниками. Пока у него в руках дубинка ПР-Таран, оружие игроков рядом заклинивает.',
      en: 'Moves with four guards. While he holds his PR-Taran baton, the weapons of players near him jam.',
    },
    health: 1055,
    weapons: { ru: 'Дубинка ПР-Таран; ПП-9 «Клин», «Кедр», КС-23М или РПД', en: 'PR-Taran baton; PP-9 Klin, Kedr, KS-23M or RPD' },
    loot: { ru: 'Резиновая дубинка ПР-Таран', en: 'PR-Taran rubber baton' },
    sources: [`${WIKI}Kollontay`, `${DEV}kollontay`, 'https://www.tarkovguide.net/boss/kollontay'],
  },
  military: {
    role: { ru: 'Военные', en: 'Military' },
    about: { ru: 'Вооружённые военные в камуфляже, шлемах с ПНВ и бронежилетах. В приложении стоят за Рейдеров на Резерве и в Лаборатории.', en: 'Armed soldiers in camouflage, NVG helmets and plate carriers. Stand for the Raiders on Reserve and in the Lab in the app.' },
  },
  'black-division': {
    role: { ru: 'Фракция TerraGroup', en: 'TerraGroup faction' },
    about: {
      ru: 'Элитное подразделение TerraGroup — «чистильщики». Работают слаженными четвёрками с разными ролями; стреляют быстро и точно.',
      en: 'TerraGroup’s elite “clean-up crew”. Work as coordinated four-man teams with set roles; fast and accurate shooters.',
    },
    loot: { ru: 'Уникальные рюкзаки, бронежилеты высокого класса, противогазы Avon, ПНВ PVS-31, бронебойные патроны', en: 'Unique backpacks, high-tier plate carriers, Avon masks, PVS-31 night vision, AP ammo' },
    sources: [`${WIKI}Black_Division`, `${DEV}black-div`, 'https://timesaver.gg/blog/tarkov-black-division-guide'],
  },
  wadge: {
    role: { ru: 'Командир Black Division', en: 'Black Division commander' },
    about: {
      ru: 'В игре — «Клин» (The Wedge), командир Black Division. На Ледоколе держится с охраной, число охранников растёт с числом игроков в рейде.',
      en: 'In game: The Wedge, the Black Division commander. On Icebreaker he holds out with guards whose number grows with the players in the raid.',
    },
    health: 880,
    weapons: { ru: 'MP7A1', en: 'MP7A1' },
    loot: { ru: 'Бронежилет Spiritus Systems LV-119 (MultiCam Black) — нужен для задания «A Wedge Between Us»; евро', en: 'Spiritus Systems LV-119 plate carrier (MultiCam Black) — needed for “A Wedge Between Us”; euros' },
    sources: [`${WIKI}The_Wedge`, 'https://v-tarkov.ru/en/boss/klin', 'https://timesaver.gg/blog/tarkov-wedge-boss-guide'],
  },

  // Ancient bosses: the owner's medieval versions (flavour only, no game stats).
  'killa-knight': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Килла в полных латах, со щитом и мечом.', en: 'Killa in full plate, with a shield and a sword.' },
    basedOn: 'killa',
  },
  'tagilla-knight': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Тагилла в сварочной маске «УБЕЙ» и табарде с крестом, с неизменной кувалдой.', en: 'Tagilla in his “UBEY” welding mask and a crusader tabard, sledgehammer in hand.' },
    basedOn: 'tagilla',
  },
  'tagilla-2-knight': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Тень Тагиллы в рогатой маске, кольчуге и табарде с крестом, с окровавленной косой.', en: 'Shadow of Tagilla in the horned mask, mail and a crusader tabard, with a bloodied scythe.' },
    basedOn: 'tagilla-2',
  },
  'reshala-knight': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Решала-крестоносец: кольчуга, латы, белый плащ с красным крестом, меч и щит.', en: 'Reshala as a crusader: mail, plate, a white surcoat with a red cross, sword and shield.' },
    basedOn: 'reshala',
  },
  'sanitar-knight': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Санитар в латах и синем табарде со львом.', en: 'Sanitar in armour and a blue tabard with a lion.' },
    basedOn: 'sanitar',
  },
  'dark-knight': {
    role: { ru: 'Рыцарь в тёмных латах', en: 'Knight in dark plate' },
    about: { ru: 'Рыцарь в тёмных латах, с маской-черепом и длинным мечом.', en: 'A knight in dark plate with a skull mask and a long sword.' },
  },
  'zryachiy-archer': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Зрячий в маске-черепе и лохмотьях, с луком вместо снайперской винтовки.', en: 'Zryachiy in his skull mask and rags, with a bow instead of a sniper rifle.' },
    basedOn: 'zryachiy',
  },
  'goon-bow': {
    role: { ru: 'Средневековые Кочевники', en: 'Medieval Goons' },
    about: { ru: 'Кочевник-лучник: стрелок отряда в древнем облике, с луком и колчаном.', en: 'The Goons’ archer: the squad’s shooter of old, with a bow and a quiver.' },
  },
  'goon-axe': {
    role: { ru: 'Средневековые Кочевники', en: 'Medieval Goons' },
    about: { ru: 'Бородатый Кочевник в древнем облике, с боевым топором.', en: 'A bearded Goon of old, with a battle axe.' },
  },
  'black-division-old': {
    role: { ru: 'Средневековая версия', en: 'Medieval version' },
    about: { ru: 'Боец Black Division в тёмном табарде с крестами.', en: 'A Black Division operative in a dark tabard with crosses.' },
    basedOn: 'black-division',
  },
  'ancient-soldier': {
    role: { ru: 'Средневековые военные', en: 'Medieval military' },
    about: { ru: 'Военный в камуфляже и маске-черепе, с плащом и табардом крестоносца.', en: 'A soldier in camo and a skull mask, with a cloak and a crusader tabard.' },
  },
}

export function bossDetails(key: string): BossDetails | undefined {
  return BOSS_INFO[key]
}
