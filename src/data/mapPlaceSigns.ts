import type { ShopSign, ShopSignFont } from './interchangeShopSigns'

/**
 * Named shops and rooms on every map (owner, 06.11.2026: «как мы сделали с картой развязки… найди магазины на улице Таркова и
 * обозначь их. Только надписи чуть поменьше, также в стилистике магазинов. Также закругленные края у рамки… на всех картах,
 * где есть какие-либо магазины, либо помещения»). Where: the map's own labels of the upstream map data (x, z in game
 * metres, each row's floor from the label's heights), buildings and rooms only: no street names, no hills, swamps or lone
 * trees, and since the owner's word of 06.11.2026 («где просто разрушенный дом, не надо писать развалины там, или конструкция») no
 * construction sites, wrecks of houses, holes and passages: shops and concrete landmarks. The look: a business has its colours by its name and kind, all the rest one plain plate; the corners as at Развязка
 * (src/components/ShopSigns.tsx). A floor is its scheme group, or its name where the map has no scheme.
 */
type Style = { bg: string; fg: string; font: ShopSignFont; italic?: boolean; accent?: ShopSign['accent']; accentColor?: string; piece?: ShopSign['piece'] }

/** One plain plate for everything that is not a business: a dark, quiet frame, so the shops stand out. */
const PLACE: Style = { bg: '#20261f', fg: '#e9e5d3', font: 'plain' }
const PHARMACY: Style = { bg: '#f2f2ee', fg: '#161616', font: 'geometric-bold', accent: 'cross', accentColor: '#3ba44a' }
const BANK: Style = { bg: '#0c5a3a', fg: '#f4f1e2', font: 'serif' }
const CAFE: Style = { bg: '#4b2e1e', fg: '#f4e6c8', font: 'script' }
const HOTEL: Style = { bg: '#2c2038', fg: '#e6cf8f', font: 'serif' }
const OFFICE: Style = { bg: '#1e2c3f', fg: '#e8edf2', font: 'thin-sans' }

/** A row: the name upstream gives it, the text in Russian, in English (when it differs), x, z, the letters' height in metres, floors, style. */
type Row = readonly [name: string, ru: string, en: string | undefined, x: number, z: number, height: number, floors: readonly string[], style: Style]

/** The plate's room: tall as asked, wide enough for the text (the plate keeps the text's proportions inside it). */
function rows(list: readonly Row[]): ShopSign[] {
  return list.flatMap(([name, ru, en, x, z, height, floors, style]) => {
    const longest = Math.max(...[ru, en ?? ru].flatMap((text) => text.split('\n')).map((line) => line.length))
    const lines = ru.includes('\n') ? 1.8 : 1
    return floors.map((floor): ShopSign => ({ name, floor, sign: ru, ...(en ? { signEn: en } : {}), x, z, w: height * (longest + 2), h: height * lines, ...style }))
  })
}

const GROUND = ['Ground_Level'] as const
/** Reserve's chess buildings: on the ground and in the basement under them (owner, 06.11.2026, proposal №64). */
const WITH_BASEMENT = ['Ground_Level', 'Bunkers'] as const
const piece = (kind: NonNullable<ShopSign['piece']>['kind'], white: boolean): Style => ({ ...PLACE, piece: { kind, white } })

const STREETS_BIG = 8
const STREETS = 5.6
const STREETS_SMALL = 4.6

const GZ_BIG = 6
const GZ = 4.5

const CUSTOMS_BIG = 11
const CUSTOMS = 8

const RESERVE = 8
const RESERVE_SMALL = 5

const WOODS_BIG = 16
const WOODS = 12

const SHORE_BIG = 16
const SHORE = 12
const SHORE_ROOM = 7

const LIGHTHOUSE_BIG = 13
const LIGHTHOUSE = 10

const IC = 6

const FACTORY = 1.8

const LAB = 2.4
const LAB_MAIN = ['Основной'] as const
const LAB_SECOND = ['2 уровень'] as const
const LAB_TECH = ['Технический уровень'] as const

export const MAP_PLACE_SIGNS: Record<string, ShopSign[]> = {
  'streets-of-tarkov': rows([
    // Shops, a mall, a car dealer and a cinema.
    ['Kilmov Shopping Mall', 'ТЦ Климов', 'Klimov Mall', -138, -196, STREETS_BIG, GROUND, { bg: '#123f7a', fg: '#ffd21a', font: 'geometric-bold', accent: 'stripe', accentColor: '#ffd21a' }],
    ['Lexos', 'LEXOS', undefined, 66, 314, STREETS_BIG, GROUND, { bg: '#17181c', fg: '#e8e8ea', font: 'thin-sans' }],
    ['Sparja Grocery', 'SPARJA', undefined, 140, 300, STREETS_BIG, GROUND, { bg: '#0a7d3c', fg: '#ffffff', font: 'geometric-bold', accent: 'stripe', accentColor: '#e0232e' }],
    ['Sparja Express', 'SPARJA Express', undefined, -64, 166, STREETS, GROUND, { bg: '#0a7d3c', fg: '#ffffff', font: 'geometric-bold', accent: 'stripe', accentColor: '#e0232e' }],
    ['Shestyorochka', 'Шестёрочка', 'Shestyorochka', -218, 135, STREETS_BIG, GROUND, { bg: '#d81f26', fg: '#ffffff', font: 'rounded', accent: 'stripe', accentColor: '#59b947' }],
    ['Cinema', 'Родина', 'Rodina', -175, 400, STREETS_BIG, GROUND, { bg: '#7a1420', fg: '#f6e3b4', font: 'serif' }],
    ['Family Market', 'Family Market', undefined, -238, 364, STREETS, GROUND, { bg: '#f28c1e', fg: '#1b1408', font: 'rounded' }],
    ['Teppakot', 'Teppakot', undefined, 65, 395, STREETS, GROUND, { bg: '#f4f1e6', fg: '#1d1d1d', font: 'serif' }],
    ['Koener', 'Koener', undefined, 65, 401, STREETS, GROUND, { bg: '#111111', fg: '#f0f0f0', font: 'thin-sans' }],
    ['LERM Expo', 'LERM Expo', undefined, 267, -155, STREETS, GROUND, { bg: '#e8c41a', fg: '#161616', font: 'geometric-bold' }],
    ['Hive', 'Hive', undefined, -238, 340, STREETS, GROUND, { bg: '#f2b90f', fg: '#201a05', font: 'rounded' }],
    // Food and coffee.
    ['Beluga', 'Beluga', undefined, -45, -52, STREETS_BIG, GROUND, { bg: '#0f2a44', fg: '#e9f1f7', font: 'script' }],
    ['Burger Spot', 'Burger Spot', undefined, -30, 138, STREETS, GROUND, { bg: '#d6381c', fg: '#ffd21a', font: 'rounded' }],
    ['Corner Restaurant', 'Ресторан', 'Corner Restaurant', -197, 340, STREETS, GROUND, CAFE],
    ['Diner', 'Diner', undefined, -80, 235, STREETS, GROUND, { bg: '#b3202a', fg: '#fff4d6', font: 'slab' }],
    ['Prestigio Cafe', 'Prestigio', undefined, 39, 230, STREETS_SMALL, GROUND, CAFE],
    ['Bilbo Coffee', 'Bilbo Coffee', undefined, -76, 430, STREETS_SMALL, GROUND, CAFE],
    // Banks and hotels.
    ['Tarbank', 'TarBank', undefined, 67, 230, STREETS, GROUND, BANK],
    ['Cardinal Bank', 'Cardinal Bank', undefined, 89, -28, STREETS, GROUND, { bg: '#7d1426', fg: '#f2d98b', font: 'serif' }],
    ['Cardinal Apartments', 'Cardinal', undefined, 99, -71, STREETS_BIG, GROUND, { bg: '#7d1426', fg: '#f2d98b', font: 'serif' }],
    ['Concordia', 'CONCORDIA', undefined, 140, 362, STREETS, GROUND, { bg: '#14233f', fg: '#e3c777', font: 'serif' }],
    ['Pinewood Hotel', 'Pinewood', undefined, -35, 64, STREETS_BIG, GROUND, { bg: '#123a2a', fg: '#e3c777', font: 'serif' }],
    ['Marked Hotel', 'Отель', 'Hotel', -200, 248, STREETS, GROUND, HOTEL],
    ['South Hotel', 'South Hotel', undefined, -175, 297, STREETS, GROUND, HOTEL],
    // Pharmacies, the post, the clinic.
    ['Pharmacy 1', 'АПТЕКА', 'PHARMACY', 42, 160, STREETS, GROUND, PHARMACY],
    ['Pharmacy 2', 'АПТЕКА', 'PHARMACY', -43, 335, STREETS, GROUND, PHARMACY],
    ['Pharmacy 3', 'АПТЕКА', 'PHARMACY', 90, -277, STREETS, GROUND, PHARMACY],
    ['Post Office', 'ПОЧТА', 'POST', 42, 97, STREETS, GROUND, { bg: '#10539c', fg: '#ffffff', font: 'geometric-bold' }],
    ['Vet Clinic', 'Ветклиника', 'Vet Clinic', 257, 175, STREETS, GROUND, { bg: '#f2f6f7', fg: '#14607a', font: 'rounded' }],
    // Everything else in a plain frame.
    ['School', 'Школа', 'School', 211, 129, STREETS, GROUND, PLACE],
  ]),

  'ground-zero': rows([
    ['TerraGroup', 'TerraGroup', undefined, -52, -36, GZ_BIG, GROUND, { bg: '#10202e', fg: '#7ad0ee', font: 'thin-sans' }],
    ['Skyside', 'Skyside', undefined, 150, 1, GZ_BIG, GROUND, OFFICE],
    ['Fusion', 'Fusion', undefined, 141, 142, GZ_BIG, GROUND, OFFICE],
    ['Empire', 'Empire', undefined, 14, 201, GZ_BIG, GROUND, { bg: '#14233f', fg: '#e3c777', font: 'serif' }],
    ['Capital Insight', 'Capital Insight', undefined, 115, 285, GZ_BIG, GROUND, OFFICE],
    ['Nakatani', 'Nakatani', undefined, -14, 346, GZ_BIG, GROUND, { bg: '#17181c', fg: '#e8e8ea', font: 'thin-sans' }],
    ['Elemental Global', 'Elemental Global', undefined, 82, -127, GZ_BIG, GROUND, OFFICE],
    ['Oasis', 'Oasis', undefined, 115, 104, GZ, GROUND, { bg: '#0c6b63', fg: '#ecf8ef', font: 'rounded' }],
    ['ASAP Winery', 'ASAP Winery', undefined, 115, 30, GZ, GROUND, { bg: '#5a1228', fg: '#f3dfb0', font: 'serif' }],
    ['Tarbank', 'TarBank', undefined, 43, 150, GZ, GROUND, BANK],
    ['GAGRIN Hotel', 'GAGRIN', undefined, 58, 234, GZ, GROUND, HOTEL],
    ['M Showroom', 'M Showroom', undefined, 97, 223, GZ, GROUND, { bg: '#17181c', fg: '#e8e8ea', font: 'geometric-bold' }],
    ['Science Office', 'Научный офис', 'Science Office', -13, 48, GZ, GROUND, OFFICE],
  ]),

  customs: rows([
    ['Big Red', 'Красные склады', 'Big Red', -175, -43, CUSTOMS_BIG, GROUND, PLACE],
    ['Dorms', 'Общежития', 'Dorms', 212, 116, CUSTOMS_BIG, GROUND, PLACE],
    ['New Gas', 'Новая заправка', 'New Gas', 404, 78, CUSTOMS_BIG, GROUND, { bg: '#c9281f', fg: '#ffffff', font: 'geometric-bold' }],
    ['Old Gas', 'Старая заправка', 'Old Gas', 345, -209, CUSTOMS_BIG, GROUND, { bg: '#c9281f', fg: '#ffffff', font: 'geometric-bold' }],
    ['Fortress', 'Крепость', 'Fortress', 205, -171, CUSTOMS_BIG, GROUND, PLACE],
    ['Streamer House', 'Дом стримера', 'Streamer House', 567, -97, CUSTOMS, GROUND, PLACE],
    ['Trailer Park', 'Трейлерный парк', 'Trailer Park', -211, -242, CUSTOMS, GROUND, PLACE],
    ['Repair Shop', 'Автосервис', 'Repair Shop', 127, -107, CUSTOMS, GROUND, { bg: '#1c4f86', fg: '#ffffff', font: 'plain' }],
    ['Warehouse 3', 'Склад 3', 'Warehouse 3', 381, -140, CUSTOMS, GROUND, PLACE],
    ['Warehouse 4', 'Склад 4', 'Warehouse 4', 333, -103, CUSTOMS, GROUND, PLACE],
    ['Warehouse 7', 'Склад 7', 'Warehouse 7', 550, -162, CUSTOMS, GROUND, PLACE],
    ['Warehouse 17', 'Склад 17', 'Warehouse 17', 46, -35, CUSTOMS, GROUND, PLACE],
    ['Depot', 'Депо', 'Depot', 463, -95, CUSTOMS, GROUND, PLACE],
    ['Military Checkpoint', 'Военный КПП', 'Military Checkpoint', 552, 28, CUSTOMS, GROUND, PLACE],
    ['Bus Station', 'Автостанция', 'Bus Station', 229, 68, CUSTOMS, GROUND, PLACE],
  ]),

  factory: rows([
    ['Office Building', 'Офисы', 'Offices', 21, 39, FACTORY, ['Ground_Floor'], PLACE],
    ['North Stairs', 'Сев. лестница', 'North Stairs', 35, 39, FACTORY, ['Ground_Floor', 'Second_Floor', 'Third_Floor'], PLACE],
    ['South Stairs', 'Юж. лестница', 'South Stairs', 9, 39, FACTORY, ['Ground_Floor', 'Second_Floor', 'Third_Floor'], PLACE],
    ['Main Office', 'Главный офис', 'Main Office', 16, 39, FACTORY, ['Third_Floor'], PLACE],
    ['Sky Bridge', 'Переход', 'Sky Bridge', 34, 26, FACTORY, ['Third_Floor'], PLACE],
    ['Locker Rooms', 'Раздевалки', 'Locker Rooms', 29, 41, FACTORY, ['Second_Floor'], PLACE],
    ['Sinks', 'Умывальники', 'Sinks', 15, 41, FACTORY, ['Second_Floor'], PLACE],
    ['Servers', 'Серверная', 'Servers', -21, 27, FACTORY, ['Second_Floor'], PLACE],
    ['Boilers', 'Котлы', 'Boilers', 56, 5, FACTORY, ['Ground_Floor', 'Second_Floor'], PLACE],
    ['Pumping Station', 'Насосная', 'Pumping Station', 41, -11, FACTORY, ['Ground_Floor', 'Second_Floor'], PLACE],
    ['Med Tent', 'Медпалатка', 'Med Tent', -18, -29, FACTORY, ['Ground_Floor'], PLACE],
    ['Silos', 'Силосы', 'Silos', 5, 11, FACTORY, ['Ground_Floor'], PLACE],
    ['Heli Crash', 'Вертолёт', 'Heli Crash', 30, -8, FACTORY, ['Ground_Floor'], PLACE],
    ['Scav Bunker', 'Бункер Диких', 'Scav Bunker', -20, 23, FACTORY, ['Ground_Floor'], PLACE],
    ['Wood Room', 'Деревянная', 'Wood Room', -45, 61, FACTORY, ['Ground_Floor'], PLACE],
    ['Glass Hall', 'Стеклянный зал', 'Glass Hall', 68, -20, FACTORY, ['Ground_Floor'], PLACE],
    ['East Halls', 'Восточные залы', 'East Halls', 44, -36, FACTORY, ['Ground_Floor'], PLACE],
    ['Underground Stash', 'Подземный схрон', 'Underground Stash', -2, -24, FACTORY, ['Basement'], PLACE],
  ]),

  interchange: rows([
    ['Power Station', 'Электростанция', 'Power Station', -179, -319, IC, GROUND, PLACE],
    ['Go Kart', 'Картинг', 'Go Kart', 155, -272, IC, GROUND, PLACE],
    ['Oli Tower', 'Вышка OLI', 'OLI Tower', 202, 219, IC, GROUND, PLACE],
    ['Idea Tower', 'Вышка IDEA', 'IDEA Tower', 47, -358, IC, GROUND, PLACE],
    ['Scav Camp', 'Лагерь Диких', 'Scav Camp', 234, -11, IC, GROUND, PLACE],
    ['Garage A', 'Паркинг A', 'Garage A', 33, -222, IC, GROUND, PLACE],
    ['Garage B', 'Паркинг B', 'Garage B', 47, -112, IC, GROUND, PLACE],
    ['Garage C', 'Паркинг C', 'Garage C', 0, 47, IC, GROUND, PLACE],
    ['Garage D', 'Паркинг D', 'Garage D', 20, 138, IC, GROUND, PLACE],
  ]),

  'the-lab': rows([
    ['Parking', 'Парковка', 'Parking', -230, -400, LAB, LAB_MAIN, PLACE],
    ['Vestibules #1', 'Вестибюль 1', 'Vestibule 1', -246, -379, LAB, LAB_MAIN, PLACE],
    ['Vestibules #2', 'Вестибюль 2', 'Vestibule 2', -216, -379, LAB, LAB_MAIN, PLACE],
    ['Main Working Area', 'Рабочая зона', 'Main Working Area', -172, -342, LAB, LAB_MAIN, PLACE],
    ['Negotiation Room', 'Переговорная', 'Negotiation Room', -148, -398, LAB, LAB_MAIN, PLACE],
    ['Infirmary Lvl 1', 'Лазарет', 'Infirmary', -130, -398, LAB, LAB_MAIN, PLACE],
    ['Test Room', 'Испытательная', 'Test Room', -134, -356, LAB, LAB_MAIN, PLACE],
    ['Server Room', 'Серверная', 'Server Room', -125, -308, LAB, LAB_MAIN, PLACE],
    ['Warehouse Tunnels', 'Тоннели склада', 'Warehouse Tunnels', -116, -266, LAB, LAB_MAIN, PLACE],
    ['Warehouse', 'Склад', 'Warehouse', -163, -269, LAB, LAB_MAIN, PLACE],
    ['Warehouse Gate', 'Ворота склада', 'Warehouse Gate', -170, -248, LAB, LAB_MAIN, PLACE],
    ['Lecture Hall', 'Лекционный зал', 'Lecture Hall', -207, -305, LAB, LAB_MAIN, PLACE],
    ['Recreation Area', 'Зона отдыха', 'Recreation Area', -221, -343, LAB, LAB_MAIN, PLACE],
    ['Gym', 'Спортзал', 'Gym', -236, -302, LAB, LAB_MAIN, PLACE],
    ["Men's Locker Room", 'Раздевалка М', "Men's Lockers", -243, -280, LAB, LAB_MAIN, PLACE],
    ["Women's Locker Room", 'Раздевалка Ж', "Women's Lockers", -230, -283, LAB, LAB_MAIN, PLACE],
    ['Boiler Room', 'Котельная', 'Boiler Room', -259, -366, LAB, [...LAB_MAIN, ...LAB_TECH], PLACE],
    ['Security Barracks', 'Казарма охраны', 'Security Barracks', -260, -319, LAB, LAB_MAIN, PLACE],
    ['Reception', 'Ресепшен', 'Reception', -260, -342, LAB, LAB_MAIN, PLACE],
    ['Administrative Office', 'Администрация', 'Administration', -255, -364, LAB, LAB_SECOND, PLACE],
    ['Security Office', 'Кабинет охраны', 'Security Office', -249, -320, LAB, LAB_SECOND, PLACE],
    ['Security #1', 'Охрана 1', 'Security 1', -244, -378, LAB, LAB_SECOND, PLACE],
    ['Security #2', 'Охрана 2', 'Security 2', -220, -379, LAB, LAB_SECOND, PLACE],
    ['Conference Room', 'Конференц-зал', 'Conference Room', -229, -343, LAB, LAB_SECOND, PLACE],
    ['Cafeteria', 'Столовая', 'Cafeteria', -219, -302, LAB, LAB_SECOND, PLACE],
    ['Offices #1', 'Офисы 1', 'Offices 1', -189, -401, LAB, LAB_SECOND, PLACE],
    ['Offices #2', 'Офисы 2', 'Offices 2', -149, -401, LAB, LAB_SECOND, PLACE],
    ['Infirmary Lvl 2', 'Лазарет', 'Infirmary', -130, -401, LAB, LAB_SECOND, PLACE],
    ['Sterile Laboratory', 'Стерильная лаборатория', 'Sterile Laboratory', -130, -361, LAB, LAB_SECOND, PLACE],
    ['Control Room', 'Пункт управления', 'Control Room', -169, -288, LAB, LAB_SECOND, PLACE],
  ]),

  lighthouse: rows([
    ['Train Yard', 'Ж/д станция', 'Train Yard', -90, -882, LIGHTHOUSE_BIG, GROUND, PLACE],
    ['Drug Lab', 'Нарколаборатория', 'Drug Lab', -120, -841, LIGHTHOUSE, GROUND, PLACE],
    ['Water Treatment', 'Водоочистка', 'Water Treatment', -97, -585, LIGHTHOUSE_BIG, GROUND, PLACE],
    ['Plant 1', 'Цех 1', 'Plant 1', 55, -665, LIGHTHOUSE, GROUND, PLACE],
    ['Plant 2', 'Цех 2', 'Plant 2', -83, -764, LIGHTHOUSE, GROUND, PLACE],
    ['Plant 3', 'Цех 3', 'Plant 3', -215, -650, LIGHTHOUSE, GROUND, PLACE],
    ['Cabins', 'Домики', 'Cabins', -285, -299, LIGHTHOUSE, GROUND, PLACE],
    ['Cottages', 'Коттеджи', 'Cottages', -163, -185, LIGHTHOUSE_BIG, GROUND, PLACE],
    ['Convenience', 'Магазин', 'Store', -41, -305, LIGHTHOUSE, GROUND, { bg: '#f28c1e', fg: '#1b1408', font: 'rounded' }],
    ['Boathouses', 'Лодочные сараи', 'Boathouses', 125, -113, LIGHTHOUSE, GROUND, PLACE],
    ['Pikes Peak Resort', 'Pikes Peak', undefined, -59, -38, LIGHTHOUSE_BIG, GROUND, HOTEL],
    ['Grand Chalet', 'Grand Chalet', undefined, -140, 66, LIGHTHOUSE, GROUND, HOTEL],
    ['Tennis Court', 'Теннисный корт', 'Tennis Court', -70, 129, LIGHTHOUSE, GROUND, PLACE],
    ['Lightkeeper Island', 'Остров Смотрителя', 'Lightkeeper Island', 440, 481, LIGHTHOUSE_BIG, GROUND, PLACE],
    ['Crash Site', 'Место крушения', 'Crash Site', -130, 296, LIGHTHOUSE, GROUND, PLACE],
  ]),

  reserve: rows([
    ['White Queen', 'Белый ферзь', 'White Queen', -41, 200, RESERVE, WITH_BASEMENT, piece('queen', true)],
    ['White Pawn', 'Белая пешка', 'White Pawn', -101, 109, RESERVE, WITH_BASEMENT, piece('pawn', true)],
    ['Black Bishop', 'Чёрный слон', 'Black Bishop', -154, -53, RESERVE, WITH_BASEMENT, piece('bishop', false)],
    ['White Bishop', 'Белый слон', 'White Bishop', -64, -49, RESERVE, WITH_BASEMENT, piece('bishop', true)],
    ['White King', 'Белый король', 'White King', -46, 43, RESERVE, WITH_BASEMENT, piece('king', true)],
    ['Black Knight', 'Чёрный конь', 'Black Knight', -4, -52, RESERVE, WITH_BASEMENT, piece('knight', false)],
    ['White Knight', 'Белый конь', 'White Knight', 89, -75, RESERVE, WITH_BASEMENT, piece('knight', true)],
    ['White Rook', 'Белая ладья', 'White Rook', 149, -124, RESERVE, WITH_BASEMENT, piece('rook', true)],
    ['Black Pawn', 'Чёрная пешка', 'Black Pawn', -168, 84, RESERVE, WITH_BASEMENT, piece('pawn', false)],
    ['Train Station', 'Вокзал', 'Train Station', 167, -114, RESERVE, GROUND, PLACE],
    ['Barracks', 'Казармы', 'Barracks', 167, -222, RESERVE, GROUND, PLACE],
    ['E1 Bunkers', 'Бункеры E1', 'E1 Bunkers', -246, -29, RESERVE, GROUND, PLACE],
    ['E2 Bunkers', 'Бункеры E2', 'E2 Bunkers', 170, -37, RESERVE, GROUND, PLACE],
    ['Warehouse Bunkers', 'Бункеры Д', 'Warehouse Bunkers', 77, -179, RESERVE, GROUND, PLACE],
    ['Garage', 'Гараж', 'Garage', 123, 30, RESERVE_SMALL, GROUND, PLACE],
    ['Mechanic', 'Мастерская', 'Workshop', 56, 61, RESERVE_SMALL, GROUND, PLACE],
    ['Gas Station', 'Заправка', 'Gas Station', 22, 16, RESERVE_SMALL, GROUND, { bg: '#c9281f', fg: '#ffffff', font: 'geometric-bold' }],
    ['Shipping Yard', 'Погрузка', 'Shipping Yard', -31, -161, RESERVE_SMALL, GROUND, PLACE],
    ['K1', 'K1', undefined, -1, -60, RESERVE_SMALL, GROUND, PLACE],
    ['K2', 'K2', undefined, 53, -71, RESERVE_SMALL, GROUND, PLACE],
    ['K3', 'K3', undefined, -5, -94, RESERVE_SMALL, GROUND, PLACE],
    ['K4', 'K4', undefined, 60, -112, RESERVE_SMALL, GROUND, PLACE],
    ['K5', 'K5', undefined, -16, -136, RESERVE_SMALL, GROUND, PLACE],
    ['K6', 'K6', undefined, 54, -132, RESERVE_SMALL, GROUND, PLACE],
    ['Dome', 'Купол', 'Dome', -17, 161, RESERVE_SMALL, GROUND, PLACE],
  ]),

  shoreline: rows([
    ['Resort', 'Здравница', 'Resort', -265, -23, SHORE_BIG, GROUND, HOTEL],
    ['West Wing', 'Западное крыло', 'West Wing', -164, -113, SHORE_ROOM, ['Ground_Level', 'Second_Floor', 'Third_Floor'], PLACE],
    ['East Wing', 'Восточное крыло', 'East Wing', -343, -116, SHORE_ROOM, ['Ground_Level', 'Second_Floor', 'Third_Floor'], PLACE],
    ['Admin', 'Администрация', 'Admin', -245, -185, SHORE_ROOM, ['Ground_Level', 'Second_Floor', 'Third_Floor'], PLACE],
    ['Power Station', 'Электростанция', 'Power Station', -223, 217, SHORE, GROUND, PLACE],
    ['Gas Station', 'Заправка', 'Gas Station', -189, 446, SHORE, GROUND, { bg: '#c9281f', fg: '#ffffff', font: 'geometric-bold' }],
    ['Weather Station', 'Метеостанция', 'Weather Station', -533, 295, SHORE, GROUND, PLACE],
    ['Radio Tower', 'Радиовышка', 'Radio Tower', -716, 115, SHORE, GROUND, PLACE],
    ['Village', 'Деревня', 'Village', 445, 164, SHORE, GROUND, PLACE],
    ['Cabins', 'Домики', 'Cabins', 301, 186, SHORE, GROUND, PLACE],
    ['Cottages', 'Коттеджи', 'Cottages', 135, 81, SHORE, GROUND, PLACE],
    ['Pier', 'Пирс', 'Pier', -353, 492, SHORE, GROUND, PLACE],
    ['Bus Stop', 'Остановка', 'Bus Stop', -96, 20, SHORE, GROUND, PLACE],
    ['Bunker', 'Бункер', 'Bunker', -140, -267, SHORE, GROUND, PLACE],
    ['Scav Farm', 'Ферма Диких', 'Scav Farm', -668, -188, SHORE, GROUND, PLACE],
  ]),

  woods: rows([
    ['Sawmill', 'Лесопилка', 'Sawmill', 82, -26, WOODS_BIG, GROUND, PLACE],
    ['Scav Town', 'Городок Диких', 'Scav Town', -533, -420, WOODS_BIG, GROUND, PLACE],
    ['Old Sawmill', 'Старая лесопилка', 'Old Sawmill', -574, -254, WOODS_BIG, GROUND, PLACE],
    ['Cultist Village', 'Деревня культистов', 'Cultist Village', -44, -668, WOODS_BIG, GROUND, PLACE],
    ['USEC Camp', 'Лагерь USEC', 'USEC Camp', 275, -475, WOODS_BIG, GROUND, PLACE],
    ['Military Camp', 'Военный лагерь', 'Military Camp', -188, 182, WOODS_BIG, GROUND, PLACE],
    ['Crash Site', 'Место крушения', 'Crash Site', -252, -37, WOODS, GROUND, PLACE],
    ['Checkpoint', 'КПП', 'Checkpoint', 239, -88, WOODS, GROUND, PLACE],
    ['Lumber', 'Лесозаготовка', 'Lumber', 7, -162, WOODS, GROUND, PLACE],
    ['Cabins', 'Домики', 'Cabins', -56, -74, WOODS, GROUND, PLACE],
    ['Bus Stop', 'Автобусная остановка', 'Bus Stop', -234, 349, WOODS, GROUND, PLACE],
    ["Jaeger's Camp", 'Лагерь Егеря', "Jaeger's Camp", -327, 19, WOODS, GROUND, PLACE],
    ['Convoy', 'Конвой', 'Convoy', 220, -595, WOODS, GROUND, PLACE],
  ]),
}
