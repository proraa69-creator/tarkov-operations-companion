/**
 * «Круг сектантов» (owner, 04.11.2026: «не тир лист, а просто лист с предметами которые 100% выпадают, по нажатию на каждый
 * предмет показывается окно что нужно положить в круг»): the circle's fixed exchanges, the rest of its rewards go by the
 * sacrifice's value and chance.
 *
 * Source: the official game wiki, «Hideout» → «Cultist Circle» → «Unique Sacrifices» (the vast majority work once) and
 * «Repeatable Sacrifices», read 04.11.2026. Checked against TarkovBox (62 recipes, updated 21.07.2026) and SPT's
 * `cultistCircle.directRewards` (the 29 exchanges both have agree). Times are the wiki's.
 * Left out, because the result is not certain: Den, Ragman, Scav and Tagilla figurines (the wiki: «and/or», «or»), 5 Ref figurines
 * (any one of a set), Nut Sack balaclava (the wiki lists one set of rewards, TarkovBox two).
 */
export type CircleStack = readonly [itemId: string, count?: number]

export interface CircleExchange {
  put: readonly CircleStack[]
  get: readonly CircleStack[]
  seconds: number
  /** Works every time; the others once. */
  repeatable?: boolean
}

export const CULTIST_EXCHANGES: readonly CircleExchange[] = [
  { put: [['665ee77ccf2d642e98220bca']], get: [['5857a8bc2459772bad15db29']], seconds: 360 }, // Secure container Gamma (The Unheard Edition) → Secure container Gamma (Edge of Darkness Edition)
  { put: [['5c093ca986f7740a1867ab12']], get: [['676008db84e242067d0dc4c9']], seconds: 3960 }, // Secure container Kappa → Secure container Kappa (Desecrated)
  { put: [['655c652d60d0ac437100fed7']], get: [['590c657e86f77412b013051d']], seconds: 3960 }, // BEAR operative figurine → Grizzly medical kit
  { put: [['6ad9cd192b8132e9720f993a']], get: [['68947a4be4bf255d1b0ca746']], seconds: 3960 }, // Black Division Operator figurine → First Spear Siege-R Optimized M.A.S.S. Plate Carrier (Black Division)
  { put: [['6ad9cce9e1f879d17605ca33']], get: [['689479a4a733b1602007e2eb']], seconds: 3960 }, // Black Division Team Leader figurine → Spiritus Systems LV-119 Plate Carrier (Black Division V1)
  { put: [['6ad9cd192b8132e9720f993a'], ['6ad9cce9e1f879d17605ca33'], ['6ad9cf0b5394c084310cac90']], get: [['617aa4dd8166f034d57de9c5', 4], ['6a8c4c7999baf8bd5802f7fe']], seconds: 3960 }, // Black Division Operator figurine + Black Division Team Leader figurine + Wedge figurine → 4 × M18 smoke grenade (Green) + Sudak-Tudak marine repair kit
  { put: [['68f2608301fb9de974058be6']], get: [['5d0379a886f77420407aa271']], seconds: 3960 }, // BTR figurine → OFZ 30x165mm shell
  { put: [['655c669103999d3c810c025b']], get: [['635267ab3c89e2112001f826']], seconds: 3960 }, // Cultist figurine → Spooky skull mask
  { put: [['655c67ab0d37ca5135388f4b']], get: [['61b9e1aaef9a1b5d6a79899a']], seconds: 3960 }, // Ded Moroz figurine → Santa's Bag
  { put: [['690c70a2a1461a01d605a1bd']], get: [['572b7d8524597762b472f9d1'], ['690c70a2a1461a01d605a1bd']], seconds: 3960 }, // Elvisvista figurine → Baseball cap + Elvisvista figurine
  { put: [['68f25da3b84c6e1f8a09cffb']], get: [['68f25da3b84c6e1f8a09cffb', 3]], seconds: 3960 }, // Fence figurine → 3 × Fence figurine
  { put: [['68f260d7b84c6e1f8a09cffd']], get: [['59e3658a86f7741776641ac4']], seconds: 3960 }, // Hideout Cat figurine → Cat figurine
  { put: [['68f25faa22c8979ee308f4da']], get: [['60db29ce99594040e04c4a27'], ['635a758bfefc88a93f021b8a']], seconds: 3960 }, // Jaeger figurine → MTs-255-12 12ga shotgun + Salty Dog beef sausage
  { put: [['66572c82ad599021091c6118']], get: [['5c0e874186f7745dc7616606'], ['5c0e842486f77443a74d2976']], seconds: 3960 }, // Killa figurine → Maska-1SCh bulletproof helmet (Killa Edition) + Maska-1SCh face shield (Killa Edition)
  { put: [['68f25fdf928cd23ddf0471fb']], get: [['64d0b40fbe2eed70e254e2d4']], seconds: 3960 }, // Lightkeeper figurine → Sacred Amulet
  { put: [['68f261f6928cd23ddf0471fd']], get: [['664d3ddfdda2e85aca370d75'], ['675aaab74bca0b001d02f356'], ['5e54f62086f774219b0f1937']], seconds: 3960 }, // Mastichin figurine → Voron's hideout key + Note with code word Voron + Raven figurine
  { put: [['68f25f1201fb9de974058be4']], get: [['57347c77245977448d35f6e2', 2], ['544fb5454bdc2df8738b456a']], seconds: 3960 }, // Mechanic figurine → 2 × Screw nuts + Leatherman Multitool
  { put: [['655c66e40b2de553b618d4b8']], get: [['5d40407c86f774318526545a', 3]], seconds: 3960 }, // Politician Mutkevich figurine → 3 × Bottle of Tarkovskaya vodka
  { put: [['68f25eef19a2b503d70dc291']], get: [['5ab8e4ed86f7742d8e50c7fa', 2]], seconds: 3960 }, // Peacekeeper figurine → 2 × MF-UNTAR body armor
  { put: [['68f25c64b2b53abd200b954f']], get: [['5bc9be8fd4351e00334cae6e']], seconds: 3960 }, // Prapor figurine → 42 Signature Blend English Tea
  { put: [['66572be36a723f7f005a066e']], get: [['5b3b713c5acfc4330140bd8d']], seconds: 3960 }, // Reshala figurine → Tokarev TT-33 7.62x25 TT pistol (Golden)
  { put: [['655c67782a1356436041c9c5']], get: [['5ed5166ad380ab312177c100'], ['59e3577886f774176a362503']], seconds: 3960 }, // Ryzhy figurine → Obdolbos cocktail injector + Pack of sugar
  { put: [['68f25eba19a2b503d70dc28f']], get: [['5b4329075acfc400153b78ff'], ['56742c324bdc2d150f8b456d']], seconds: 3960 }, // Skier figurine → Pompon hat + Broken GPhone smartphone
  { put: [['68f25ce9b2b53abd200b9551']], get: [['544fb45d4bdc2dee738b4568']], seconds: 3960 }, // Therapist figurine → Salewa first aid kit
  { put: [['655c663a6689c676ce57af85']], get: [['5c0e655586f774045612eeb2']], seconds: 3960 }, // USEC operative figurine → HighCom Trooper TFO body armor (MultiCam)
  { put: [['68f26124b84c6e1f8a09cfff']], get: [['59e7635f86f7742cbf2c1095', 2], ['5bf3e03b0db834001d2c4a9c', 2]], seconds: 3960 }, // Walking Tank figurine → 2 × BNTI Module-3M body armor + 2 × Kalashnikov AK-74 5.45x39 assault rifle
  { put: [['6ad9cf0b5394c084310cac90']], get: [['69f07893e761ac1c200ae15b']], seconds: 3960 }, // Wedge figurine → Model 8230 CS gas grenade
  { put: [['679b9d55708cfcb2060b9ae3']], get: [['590c346786f77423e50ed342']], seconds: 3960 }, // Xenoalien figurine → Xenomorph sealing foam
  { put: [['679b9d43597ba2ed120c3d44']], get: [['62a09e974f842e1bd12da3f0']], seconds: 3960 }, // Petya Crooker figurine → Video cassette with the Cyborg Killer movie
  { put: [['679b9cce4e4ed4b3b40ae5c5']], get: [['590c31c586f774245e3141b2']], seconds: 3960 }, // Nailhead figurine → Pack of nails
  { put: [['679b9d4b3374fb14f40efe6d']], get: [['5b4335ba86f7744d2837a264']], seconds: 3960 }, // Count Bloodsucker figurine → Medical bloodset
  { put: [['679b9d4b3374fb14f40efe6d'], ['679b9cce4e4ed4b3b40ae5c5'], ['679b9d43597ba2ed120c3d44'], ['679b9d6390622daf9708da76'], ['679b9d55708cfcb2060b9ae3']], get: [['67ea616a74f765cefd009fb7']], seconds: 3960 }, // Count Bloodsucker figurine + Nailhead figurine + Petya Crooker figurine + Pointy guy figurine + Xenoalien figurine → Tagilla's welding mask "ZABEY" (Replica)
  { put: [['69774bb0a247161ff1068335', 5]], get: [['697cddb414e932098005748d']], seconds: 3960 }, // 5 × Can of duck pate → Duck figurine
  { put: [['6937f02dfd6488bb27024839']], get: [['63a39ce4cd6db0635c1975fa'], ['620109578d82e67e7911abf2'], ['5d403f9186f7743cac3f229b']], seconds: 3960 }, // Domontovich ushanka hat → Supply department director's office key + ZiD SP-81 26x75 signal pistol + Bottle of Dan Jackiel whiskey
  { put: [['679b992329acd1f2f60985a5']], get: [['679b9819a2f2dd4da9023512']], seconds: 3960 }, // Labrys research notes → Labrys access keycard
  { put: [['5d03794386f77420415576f5']], get: [['6939948dc2ceb9acd7082eb2']], seconds: 3960 }, // 6-STEN-140-M military battery → Old house toilet key
  { put: [['6937ecf8628ee476240c07cb']], get: [['62a09cfe4f842e1bd12da3e4']], seconds: 3960 }, // Tigzresq splint → Golden egg
  { put: [['5aa2b986e5b5b00014028f4c']], get: [['62a091170b9d3c46de5b6cf2']], seconds: 3960 }, // Dundukk sport sunglasses → Axel parrot figurine
  { put: [['6582dbf0b8d7830efc45016f']], get: [['5d1b376e86f774252519444e']], seconds: 3960 }, // Relaxation room key → Bottle of Fierce Hatchling moonshine
  { put: [['5c13cd2486f774072c757944']], get: [['62a0a098de7ac8199358053b']], seconds: 3960 }, // Soap → Awl
  { put: [['5a0c27731526d80618476ac4']], get: [['5d1b392c86f77425243e98fe', 2]], seconds: 3960 }, // Zarya stun grenade → 2 × Light bulb
  { put: [['5448fee04bdc2dbc018b4567']], get: [['5e2af47786f7746d404f3aaa']], seconds: 3960 }, // Bottle of water (0.6L) → Fleece fabric
  { put: [['590c695186f7741e566b64a2']], get: [['5fca138c2a7b221b2852a5c6']], seconds: 3960 }, // Augmentin antibiotic pills → xTG-12 antidote injector
  { put: [['590c5c9f86f77477c91c36e7']], get: [['590c5bbd86f774785762df04']], seconds: 3960 }, // WD-40 (400ml) → WD-40 (100ml)
  { put: [['634959225289190e5e773b3b']], get: [['59ef13ca86f77445fd0e2483']], seconds: 3960 }, // Pumpkin with sweets → Jack-o'-lantern tactical pumpkin helmet
  { put: [['5df8a6a186f77412640e2e80']], get: [['5df8a72c86f77412640e2e83']], seconds: 3960 }, // Christmas tree ornament (Red) → Christmas tree ornament (Silver)
  { put: [['5df8a72c86f77412640e2e83']], get: [['5df8a77486f77412672a1e3f']], seconds: 3960 }, // Christmas tree ornament (Silver) → Christmas tree ornament (Violet)
  { put: [['5df8a77486f77412672a1e3f']], get: [['5df8a6a186f77412640e2e80']], seconds: 3960 }, // Christmas tree ornament (Violet) → Christmas tree ornament (Red)
  { put: [['5df8a6a186f77412640e2e80'], ['5df8a72c86f77412640e2e83'], ['5df8a77486f77412672a1e3f']], get: [['655c67ab0d37ca5135388f4b', 2]], seconds: 3960 }, // Christmas tree ornament (Red) + Christmas tree ornament (Silver) + Christmas tree ornament (Violet) → 2 × Ded Moroz figurine
  { put: [['6638a5474e92f038531e210e']], get: [['6638a5474e92f038531e210e'], ['5c94bbff86f7747ee735c08f']], seconds: 3960 }, // Mr Kerman's cat hologram → Mr Kerman's cat hologram + TerraGroup Labs access keycard
  { put: [['679b9d6390622daf9708da76']], get: [['64d4b23dc1b37504b41ac2b6']], seconds: 3960 }, // Pointy guy figurine → Rusted bloody key
  { put: [['655c669103999d3c810c025b', 5]], get: [['5fc64ea372b0dd78d51159dc']], seconds: 39960 }, // 5 × Cultist figurine → Cultist knife
  { put: [['5c0530ee86f774697952d952']], get: [['6389c8c5dbfd5e4b95197e6b']], seconds: 39960 }, // LEDX Skin Transilluminator → TerraGroup "Blue Folders" materials
  { put: [['59faff1d86f7746c51718c9c']], get: [['5e2aedd986f7746d404f3aa4', 2], ['5c12620d86f7743f8b198b72', 2]], seconds: 39960 }, // Physical Bitcoin → 2 × GreenBat lithium battery + 2 × Tetriz portable game console
  { put: [['68f11adfcd0babab2c0fb003']], get: [['68f119c6121d878a2303eee3']], seconds: 666, repeatable: true }, // Left half of a Physical Bitcoin → Right half of a Physical Bitcoin
  { put: [['68f119c6121d878a2303eee3']], get: [['68f11adfcd0babab2c0fb003']], seconds: 666, repeatable: true }, // Right half of a Physical Bitcoin → Left half of a Physical Bitcoin
  { put: [['68f11adfcd0babab2c0fb003'], ['68f119c6121d878a2303eee3']], get: [['59faff1d86f7746c51718c9c']], seconds: 666, repeatable: true }, // Left half of a Physical Bitcoin + Right half of a Physical Bitcoin → Physical Bitcoin
  { put: [['6937edb912d456a817083e82']], get: [['6937edb912d456a817083e82']], seconds: 3960, repeatable: true }, // Mazoni golden dumbbell → Mazoni golden dumbbell
  { put: [['68f117b8121d878a2303eee0']], get: [['68f117b8121d878a2303eee0']], seconds: 3960, repeatable: true }, // Secure container Gamma (Loui Peeton) → Secure container Gamma (Loui Peeton)
  { put: [['6841b6b674a3c16f5e03d653']], get: [['6841b6b674a3c16f5e03d653']], seconds: 3960, repeatable: true }, // PMC Origins figurine → PMC Origins figurine
]

export const stackCount = ([, count = 1]: CircleStack) => count

/**
 * What an exchange is worth doing for: what comes out beyond what went in (a Fence figurine gives three; an Elvisvista figurine
 * comes back with a baseball cap, which is the reward). An exchange that only returns its item is worth it for that item.
 */
export function exchangeRewards(exchange: CircleExchange): readonly CircleStack[] {
  const gains = exchange.get.filter((stack) => {
    const spent = exchange.put.find(([id]) => id === stack[0])
    return stackCount(stack) > (spent ? stackCount(spent) : 0)
  })
  return gains.length ? gains : exchange.get
}

/**
 * Everything that drops, to be written together (owner, 05.11.2026: «Можешь это записывать вместе, все, что выпадет»): the
 * rewards, then what only comes back.
 */
export function exchangeDrops(exchange: CircleExchange): readonly CircleStack[] {
  const rewards = exchangeRewards(exchange)
  return [...rewards, ...exchange.get.filter((stack) => !rewards.includes(stack))]
}

export interface CircleRow {
  key: string
  exchange: CircleExchange
  /** Everything that drops. */
  drops: readonly CircleStack[]
  /** What of it a quest or the hideout may want: an item that only comes back is no gain. */
  rewards: readonly CircleStack[]
}

/** One row per exchange; `known`: only exchanges whose every item the catalog has. */
export function circleRows(known: (itemId: string) => boolean = () => true, exchanges: readonly CircleExchange[] = CULTIST_EXCHANGES): CircleRow[] {
  return exchanges.filter(({ put, get }) => [...put, ...get].every(([id]) => known(id))).map((exchange) => {
    const drops = exchangeDrops(exchange)
    return { key: [...exchange.put, ...drops].map(([id]) => id).join('+'), exchange, drops, rewards: exchangeRewards(exchange) }
  })
}

/** «1 ч 6 мин» / «1 h 6 min». */
export function circleTime(seconds: number, locale: 'ru' | 'en' = 'ru') {
  const parts: Array<[number, string, string]> = [[Math.floor(seconds / 3600), 'ч', 'h'], [Math.floor(seconds / 60) % 60, 'мин', 'min'], [seconds % 60, 'с', 's']]
  return parts.filter(([value]) => value > 0).map(([value, ru, en]) => `${value} ${locale === 'en' ? en : ru}`).join(' ')
}
