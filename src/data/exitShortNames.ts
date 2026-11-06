/**
 * The short name under an exit's icon on the map (owner, 05.11.2026: «у каждого выхода должно быть маленькое короткое название…
 * бункер контрабандистов, он просто называется ЗБ-1012… чтобы они были не на пол экрана»). The exit's whole name stays in its
 * tooltip and card. By the name the catalog gives, in either language: [Russian, English, short Russian, short English].
 */
const NAMES: ReadonlyArray<readonly [string, string, string, string]> = [
  // Factory
  ['Ворота у медицинской палатки', 'Med Tent Gate', 'Мед. палатка', 'Med Tent'],
  ['Подвалы', 'Cellars', 'Подвалы', 'Cellars'],
  ['Ворота 0', 'Gate 0', 'Ворота 0', 'Gate 0'],
  ['Ворота 2', 'Gate 2', 'Ворота 2', 'Gate 2'],
  ['Ворота 3', 'Gate 3', 'Ворота 3', 'Gate 3'],
  ['Проход Контрабандистов', "Smugglers' Passage", 'Контрабандисты', 'Smugglers'],
  ['Ворота во дворе', 'Courtyard Gate', 'Двор', 'Courtyard'],
  ['Бункерная дверь с камерой', 'Camera Bunker Door', 'Дверь с камерой', 'Camera Door'],
  ['Офисное окно', 'Office Window', 'Офисное окно', 'Office Window'],
  // Customs
  ['Старая заправка', 'Old Gas Station', 'Старая заправка', 'Old Gas Station'],
  ['ЖД к Резерву', 'Railroad to Reserve', 'ЖД к Резерву', 'Rail to Reserve'],
  ['Перекресток', 'Crossroads', 'Перекрёсток', 'Crossroads'],
  ['Административные ворота', 'Administration Gate', 'Адм. ворота', 'Admin Gate'],
  ['Ворота на старой дороге', 'Old Road Gate', 'Старая дорога', 'Old Road'],
  ['Блокпост ВС РФ', 'RUAF Roadblock', 'Блокпост ВС РФ', 'RUAF Block'],
  ['Блокпост снайперов', 'Sniper Roadblock', 'Пост снайперов', 'Sniper Block'],
  ['Заводские времянки', 'Factory Shacks', 'Времянки', 'Shacks'],
  ['Склад 4', 'Warehouse 4', 'Склад 4', 'Warehouse 4'],
  ['Подвал котельной (Совм.)', 'Boiler Room Basement (Co-op)', 'Котельная', 'Boiler Room'],
  ['Проход через ЖД пути (Сигнал)', 'Railroad Passage (Flare)', 'ЖД проход', 'Rail Passage'],
  ['ЖД к порту', 'Railroad to Port', 'ЖД к порту', 'Rail to Port'],
  ['Ворота у медблока', 'Gate Near Medblock', 'Медблок', 'Medblock'],
  ['ЗБ-1011', 'ZB-1011', 'ЗБ-1011', 'ZB-1011'],
  ['Бункер Контрабандистов (ЗБ-1012)', "Smugglers' Bunker (ZB-1012)", 'ЗБ-1012', 'ZB-1012'],
  ['ЗБ-1013', 'ZB-1013', 'ЗБ-1013', 'ZB-1013'],
  ['ЖД до Таркова', 'Railroad to Tarkov', 'ЖД до Таркова', 'Rail to Tarkov'],
  ['КПП к Резерву', 'Reserve Checkpoint', 'КПП к Резерву', 'Reserve CP'],
  ['Трейлерный парк', 'Trailer Park', 'Трейлерный парк', 'Trailer Park'],
  ['А-Выход у общаги', 'Dorms V-Ex', 'А-выход общага', 'Dorms V-Ex'],
  ['Проход между скалами', 'Passage Between Rocks', 'Между скал', 'Rocks'],
  ['Лодка Контрабандистов', "Smugglers' Boat", 'Лодка', 'Boat'],
  // Woods
  ['ЗБ-014', 'ZB-014', 'ЗБ-014', 'ZB-014'],
  ['ЗБ-016', 'ZB-016', 'ЗБ-016', 'ZB-016'],
  ['Южный пост ООН', 'UN Roadblock', 'Пост ООН', 'UN Block'],
  ['Северный пост ООН', 'Northern UN Roadblock', 'Сев. пост ООН', 'North UN'],
  ['Старое депо', 'Old Railway Depot', 'Старое депо', 'Old Depot'],
  ['Изба Диких', 'Scav House', 'Изба Диких', 'Scav House'],
  ['Восточные скалы', 'Eastern Rocks', 'Вост. скалы', 'East Rocks'],
  ['Горный тайник', 'Mountain Stash', 'Горный тайник', 'Mtn Stash'],
  ['Проход у ЛЭП (Сигнал)', 'Power Line Passage (Flare)', 'Проход у ЛЭП', 'Power Line'],
  ['Окраины', 'Outskirts', 'Окраины', 'Outskirts'],
  ['Бункер Диких', 'Scav Bunker', 'Бункер Диких', 'Scav Bunker'],
  ['Ворота ВС РФ', 'RUAF Gate', 'Ворота ВС РФ', 'RUAF Gate'],
  ['Убежище мертвеца', "Dead Man's Place", 'Убежище мертвеца', "Dead Man's"],
  ['Мост дружбы (Совм.)', 'Friendship Bridge (Co-Op)', 'Мост дружбы', 'Friendship Bridge'],
  ['Лодка', 'Boat', 'Лодка', 'Boat'],
  ['ЖД-мост к Таркову', 'Railway Bridge to Tarkov', 'ЖД-мост', 'Rail Bridge'],
  ['А-Выход на мосту', 'Bridge V-Ex', 'А-выход мост', 'Bridge V-Ex'],
  // Lighthouse
  ['Бронепоезд', 'Armored Train', 'Бронепоезд', 'Armored Train'],
  ['Южная дорога', 'Southern Road', 'Южная дорога', 'South Road'],
  ['Обвал на шоссе', 'Southern Road Landslide', 'Обвал', 'Landslide'],
  ['Тропа через перевал', 'Mountain Pass', 'Перевал', 'Mtn Pass'],
  ['Проход у озера', 'Passage by the Lake', 'У озера', 'By the Lake'],
  ['Северный блокпост', 'Northern Checkpoint', 'Сев. блокпост', 'North CP'],
  ['Схрон под дебаркадером', 'Hideout Under the Landing Stage', 'Схрон', 'Hideout'],
  ['Укрытие в гроте', 'Scav Hideout at the Grotto', 'Грот', 'Grotto'],
  ['Ворота промзоны', 'Industrial Zone Gates', 'Промзона', 'Industrial'],
  ['Боковой тоннель (Совм.)', 'Side Tunnel (Co-Op)', 'Бок. тоннель', 'Side Tunnel'],
  ['Переход на Берег', 'Path to Shoreline', 'Берег', 'Shoreline'],
  ['Дорога к военной базе (V-Ex)', 'Road to Military Base V-Ex', 'А-выход база', 'Base V-Ex'],
  // Shoreline
  ['Тропа альпиниста', "Climber's Trail", 'Тропа альпиниста', "Climber's Trail"],
  ['Подвал в адм. корпусе', 'Admin Basement', 'Адм. подвал', 'Admin Basement'],
  ['Тоннель', 'Tunnel', 'Тоннель', 'Tunnel'],
  ['Проход через скалы', 'Rock Passage', 'Через скалы', 'Rock Passage'],
  ['Маяк', 'Lighthouse', 'Маяк', 'Lighthouse'],
  ['Путь контрабандиста (Совм.)', "Smugglers' Path (Co-op)", 'Контрабандисты', 'Smugglers'],
  ['Тупик Светлый', 'Svetliy Dead End', 'Тупик Светлый', 'Svetliy'],
  ['Переход на Маяк', 'Path to Lighthouse', 'Маяк', 'Lighthouse'],
  ['Разрушенная дорога', 'Ruined Road', 'Разруш. дорога', 'Ruined Road'],
  ['Временный КПП', 'CCP Temporary', 'Временный КПП', 'Temp CCP'],
  ['Дорога на Таможню', 'Road to Customs', 'На Таможню', 'To Customs'],
  ['Вход в спортзал восточного крыла', 'East Wing Gym Entrance', 'Спортзал', 'Gym'],
  ['ЖД-мост', 'Railway Bridge', 'ЖД-мост', 'Rail Bridge'],
  ['Забор у разруш. дома', 'Ruined House Fence', 'Забор', 'House Fence'],
  ['Лодка на причале', 'Pier Boat', 'Лодка', 'Pier Boat'],
  ['Бункер в горе', 'Mountain Bunker', 'Бункер в горе', 'Mtn Bunker'],
  ['А-Выход дорога на север', 'Road to North V-Ex', 'А-выход север', 'North V-Ex'],
  ['Спуск со скалы', 'Cliff Descent', 'Спуск со скалы', 'Cliff Descent'],
  // Reserve
  ['Трубопровод отопления', 'Heating Pipe', 'Трубопровод', 'Heating Pipe'],
  ['Выход в сторону Леса', 'Exit to Woods', 'К Лесу', 'To Woods'],
  ['Дыра в заборе у скал', 'Hole in the Wall by the Mountains', 'Дыра в заборе', 'Wall Hole'],
  ['Канализационный люк', 'Sewer Manhole', 'Люк', 'Manhole'],
  ['Д-2', 'D-2', 'Д-2', 'D-2'],
  ['Забор у КПП', 'Checkpoint Fence', 'Забор у КПП', 'CP Fence'],
  ['Гермозатвор бункера', 'Bunker Hermetic Door', 'Гермозатвор', 'Hermetic Door'],
  ['Дикие места (Совм.)', 'Scav Lands (Co-Op)', 'Дикие места', 'Scav Lands'],
  ['Гермодверь к депо', 'Depot Hermetic Door', 'Гермодверь', 'Depot Door'],
  // Interchange
  ['Выход на железной дороге', 'Railway Exfil', 'ЖД выход', 'Railway'],
  ['Безопасная комната', 'Saferoom Exfil', 'Безоп. комната', 'Saferoom'],
  ['КПП МЧС', 'Emercom Checkpoint', 'КПП МЧС', 'Emercom'],
  ['Лагерь Диких (Совм.)', 'Scav Camp (Co-Op)', 'Лагерь Диких', 'Scav Camp'],
  ['Тропа к реке (Сигнал)', 'Path to River (Flare)', 'К реке', 'To River'],
  ['А-Выход у ТЭЦ', 'Power Station V-Ex', 'А-выход ТЭЦ', 'Power V-Ex'],
  ['Дыра в заборе', 'Hole in the Fence', 'Дыра в заборе', 'Fence Hole'],
  // Streets of Tarkov
  ['Упавший кран', 'Collapsed Crane', 'Упавший кран', 'Crane'],
  ['Место крушения', 'Crash Site', 'Место крушения', 'Crash Site'],
  ['Разрушенный дом', 'Damaged House', 'Разруш. дом', 'Damaged House'],
  ['Паркинг ЖК Кардинал', 'Cardinal Apartment Complex Parking', 'Паркинг Кардинал', 'Cardinal Parking'],
  ['Вход в катакомбы', 'Entrance to Catacombs', 'Катакомбы', 'Catacombs'],
  ['Подвал в Pinewood (Совм.)', 'Pinewood Basement (Co-Op)', 'Подвал Pinewood', 'Pinewood'],
  ['Выход ТЦ на Климова', 'Klimov Shopping Mall Exfil', 'ТЦ Климова', 'Klimov Mall'],
  ['Лифт в стилобате', 'Stylobate Building Elevator', 'Лифт стилобат', 'Stylobate Lift'],
  ['Улица Климова (Сигнал)', 'Klimov Street (Flare)', 'ул. Климова', 'Klimov St'],
  ['Вход у арки на Камчатской', 'Near Kamchatskaya Arch', 'Арка', 'Arch'],
  ['Двор-колодец', 'Courtyard', 'Двор-колодец', 'Courtyard'],
  ['Вентиляционная шахта', 'Ventilation Shaft', 'Вент. шахта', 'Vent Shaft'],
  ['КПП у выставочного центра', 'Expo Checkpoint', 'КПП Экспо', 'Expo CP'],
  ['Подвал Контрабандистов', "Smugglers' Basement", 'Контрабандисты', 'Smugglers'],
  ['Река в коллекторе', 'Sewer River', 'Коллектор', 'Sewer River'],
  ['Блокпост Диких', 'Scav Checkpoint', 'Блокпост Диких', 'Scav CP'],
  ['А-выход Такси на Приморском', 'Primorsky Ave Taxi V-Ex', 'А-выход такси', 'Taxi V-Ex'],
  ['Канализация', 'Sewer Manhole', 'Канализация', 'Manhole'],
  ['Вход в подвал', 'Basement Entrance', 'Подвал', 'Basement'],
  // The Lab
  ['Ангар', 'Hangar Gate', 'Ангар', 'Hangar'],
  ['Лифт медблока', 'Medical Block Elevator', 'Лифт медблока', 'Med Lift'],
  ['Грузовой лифт', 'Cargo Elevator', 'Грузовой лифт', 'Cargo Lift'],
  ['Центральный лифт', 'Main Elevator', 'Центр. лифт', 'Main Lift'],
  ['Парковка', 'Parking Gate', 'Парковка', 'Parking'],
  ['Накопительный коллектор', 'Sewage Conduit', 'Коллектор', 'Sewage'],
  // Ground Zero
  ['Спуск в подвал в Nakatani', 'Nakatani Basement Stairs', 'Nakatani', 'Nakatani'],
  ['Блокпост Диких (Совм.)', 'Scav Checkpoint (Co-op)', 'Блокпост Диких', 'Scav CP'],
  ['Офис продаж Tartowers', 'Tartowers Sales Office', 'Tartowers', 'Tartowers'],
  ['Проспект Мира (Сигнал)', 'Mira Ave (Flare)', 'Пр. Мира', 'Mira Ave'],
  ['Пункт МЧС', 'Emercom Checkpoint', 'Пункт МЧС', 'Emercom'],
  ['А-Выход полицейский кордон', 'Police Cordon V-Ex', 'А-выход кордон', 'Police V-Ex'],
  // The Labyrinth, Icebreaker
  ['Путь наверх', 'The Way Up', 'Путь наверх', 'The Way Up'],
  ['Тропа Ариадны', "Ariadne's Path", 'Тропа Ариадны', "Ariadne's Path"],
  ['Вертолет', 'Helicopter', 'Вертолёт', 'Helicopter'],
]

const keyOf = (name: string) => name.trim().toLowerCase().replace(/ё/g, 'е')
/** The same name with its note in brackets gone: «(Совм.)», «(Co-op)», «(Сигнал)» differ between the catalog's languages. */
const bare = (name: string) => keyOf(name.replace(/\s*\([^)]*\)\s*$/, ''))

// A name shared by two exits (the same Emercom in English) gives the first one's short name: they read the same anyway.
const SHORT = new Map<string, { ru: string; en: string }>()
for (const [ru, en, shortRu, shortEn] of NAMES) {
  const short = { ru: shortRu, en: shortEn }
  for (const key of [keyOf(ru), keyOf(en), bare(ru), bare(en)]) if (!SHORT.has(key)) SHORT.set(key, short)
}

/** Where a transit leads, by the map's name in either language (the catalog names it «Переход на карту …»). */
const MAPS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Таможня', 'Customs', 'Таможня', 'Customs'], ['Лес', 'Woods', 'Лес', 'Woods'], ['Завод', 'Factory', 'Завод', 'Factory'],
  ['Берег', 'Shoreline', 'Берег', 'Shoreline'], ['Маяк', 'Lighthouse', 'Маяк', 'Lighthouse'], ['Резерв', 'Reserve', 'Резерв', 'Reserve'],
  ['Развязка', 'Interchange', 'Развязка', 'Interchange'], ['Улицы Таркова', 'Streets of Tarkov', 'Улицы', 'Streets'],
  ['Лаборатория', 'The Lab', 'Лаборатория', 'The Lab'], ['Лабиринт', 'The Labyrinth', 'Лабиринт', 'Labyrinth'],
  ['Эпицентр', 'Ground Zero', 'Эпицентр', 'Ground Zero'], ['Ледокол', 'Icebreaker', 'Ледокол', 'Icebreaker'], ['Терминал', 'Terminal', 'Терминал', 'Terminal'],
]

/** «Переход на карту Улицы Таркова» → «Улицы», «Transit to Woods» → «Woods»: the icon already says it is a transit (owner, 06.11.2026: «Вот эти стрелочки убери»). */
function transitName(name: string, locale: 'ru' | 'en') {
  const match = /^(?:Переход на(?: карту)?|Transit to)\s+(.+?)\??$/i.exec(name.trim())
  if (!match) return undefined
  const place = keyOf(match[1]!)
  const known = MAPS.find(([ru, en]) => keyOf(ru) === place || keyOf(en) === place)
  return known ? known[locale === 'en' ? 3 : 2]! : match[1]!
}

/** The short name of an exit or a transit; a name not listed (a new exit) loses only what stands in brackets. */
export function exitShortName(name: string, locale: 'ru' | 'en') {
  return (SHORT.get(keyOf(name)) ?? SHORT.get(bare(name)))?.[locale] ?? transitName(name, locale) ?? name.replace(/\s*\([^)]*\)\s*$/, '').trim()
}
