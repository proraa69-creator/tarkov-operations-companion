/**
 * English for «Арсенал → Сборщик оружия» (src/pages/GunBuilderPage.tsx, src/arsenal/GunSlotTree.tsx).
 * Words the app already translates (Вес, Цена, Патрон, модулей, Сохранить…) are not repeated here: a second entry
 * with another English word would override the first one everywhere.
 */
export const GUN_BUILDER_PHRASES: Array<[string, string]> = [
  ['Сборщик оружия', 'Gun Builder'], ['Арсенал ·', 'Arsenal ·'], ['Арсенал', 'Arsenal'], ['данные онлайн', 'data online'],
  ['Пусто', 'Empty'], ['Вес', 'Weight'], ['Стоимость', 'Cost'], ['Загрузить', 'Load'], ['Отдача', 'Recoil'],
  ['Соберите оружие из совместимых модулей: отдача, эргономика, вес и цена считаются сразу и сравниваются с заводской сборкой.', 'Build a weapon from compatible mods: recoil, ergonomics, weight and cost update instantly and are compared with the default preset.'],
  ['кэш данных', 'data cache'], ['оружия', 'weapons'],
  ['Загружаем оружие и модули', 'Loading weapons and mods'],
  ['Каталог модулей большой — он загружается только при открытии сборщика и кэшируется.', 'The mod catalogue is large: it loads only when the builder opens and is cached.'],
  ['Источник данных недоступен', 'The data source is unavailable'], ['Не удалось загрузить оружие и модули, а сохранённой копии ещё нет.', 'Weapons and mods could not be loaded and there is no saved copy yet.'],
  ['Изображение заводской сборки', 'Default preset image'], ['выстр/мин', 'rpm'], ['Заводская сборка', 'Default preset'], ['Пустая', 'Empty'],
  ['Не установлены обязательные модули', 'Required mods missing'], ['У этого оружия нет слотов для модулей.', 'This weapon has no mod slots.'],
  ['Название или калибр…', 'Name or caliber…'], ['Поиск оружия', 'Search weapons'], ['Все классы', 'All classes'], ['Оружие не найдено.', 'No weapons found.'],
  ['Штурмовые винтовки', 'Assault rifles'], ['Штурмовые карабины', 'Assault carbines'], ['Пехотные винтовки', 'Marksman rifles'], ['Снайперские винтовки', 'Sniper rifles'],
  ['Пистолеты-пулемёты', 'Submachine guns'], ['Дробовики', 'Shotguns'], ['Пулемёты', 'Machine guns'], ['Пистолеты', 'Pistols'], ['Револьверы', 'Revolvers'], ['Гранатомёты', 'Grenade launchers'],
  ['Характеристики', 'Stats'], ['против заводской', 'vs default preset'], ['Вертикальная отдача', 'Vertical recoil'], ['Горизонтальная отдача', 'Horizontal recoil'],
  ['Эргономика', 'Ergonomics'], ['Точность ≈ MOA', 'Accuracy ≈ MOA'],
  ['Отдача: база × (1 + Σ модификаторов модулей и патрона), по вики Escape from Tarkov. Сумма модификаторов', 'Recoil: base × (1 + Σ mod and ammo modifiers), per the Escape from Tarkov wiki. Sum of modifiers'],
  ['MOA — приблизительная оценка по стволу, без навыков и разброса патрона.', 'MOA is an approximation from the barrel, without skills or ammo dispersion.'],
  ['Нет данных о патронах этого калибра.', 'No ammo data for this caliber.'], ['Проб.', 'Pen.'], ['Урон броне', 'Armor damage'], ['Скорость, м/с', 'Velocity, m/s'], ['м/с', 'm/s'],
  ['Где купить', 'Where to buy'], ['Лояльность торговцев', 'Trader loyalty'], ['Барахолка доступна', 'Flea market unlocked'],
  ['Без цены (бартер, крафт или нужна лояльность выше)', 'Without a price (barter, craft or higher loyalty needed)'],
  ['запрет барахолки', 'flea banned'], ['нет в продаже', 'not sold'], ['не купить', 'not for sale'],
  ['Сборки', 'Builds'], ['Название сборки', 'Build name'], ['Копировать код', 'Copy code'], ['Копировать текстом', 'Copy as text'], ['Код сборки', 'Build code'],
  ['Вставьте код RB1…', 'Paste an RB1… code'], ['Код для загрузки', 'Code to load'],
  ['Сохранённых сборок для этого режима пока нет.', 'No saved builds for this mode yet.'],
  ['Код скопирован', 'Code copied'], ['Текст скопирован', 'Text copied'], ['Не удалось скопировать', 'Could not copy'], ['Код не распознан', 'Code not recognised'], ['Сборка загружена', 'Build loaded'], ['Сохранено', 'Saved'],
  ['обязательный', 'required'], ['Без этого модуля оружие не стреляет', 'The weapon cannot fire without this mod'], ['пусто', 'empty'], ['Не установлен', 'Not installed'], ['вариантов', 'options'],
  ['Снять модуль', 'Remove mod'], ['Найти модуль…', 'Find a mod…'], ['Конфликтует с', 'Conflicts with'], ['Конфликт', 'Conflict'], ['Подходящих модулей нет в базе.', 'No compatible mods in the database.'],
  ['Эрг', 'Ergo'], ['Отд', 'Recoil'], ['Точн', 'Acc'], ['патр.', 'rds'],
]
