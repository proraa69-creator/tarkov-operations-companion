/** English strings for the colour themes (Settings picker, top-bar theme button) and their small jokes. */
export const THEME_PHRASES: Array<[string, string]> = [
  ['Чёрный мультикам', 'Black MultiCam'],
  ['Перфорация', 'Perforated steel'],
  ['Ржавая сталь', 'Rusted steel'],
  ['Металл', 'Metal'],
  ['Тельняшка', 'Telnyashka'],
  // «Алькантара»: the theme and its thread-colour option (src/theme/alcantara/StitchChooser.tsx)
  ['Алькантара', 'Alcantara'], ['Строчка', 'Stitching'], ['Цвет ниток на швах', 'Thread colour of the seams'],
  ['Серая', 'Grey'], ['Контрастная', 'Contrast'],
  // Telnyashka sidebar tagline: drawn by CSS (themes.css) in both languages via :root[lang]; listed here for the audit.
  ['Бутылка водки — и в рейд.', 'A bottle of vodka — then the raid.'],
  ['Маска', 'Mask'], ['Сталь, царапины', 'Scratched steel'], ['Маска Тагиллы', 'Tagilla mask'], ['Шлем Киллы', 'Killa helmet'], ['Маска Тагиллы 2', 'Tagilla mask 2'], ['Показать маску', 'Show mask'], ['Убрать маску', 'Hide mask'], ['Рыцарь', 'Knight'],
  // mask settings (HelmetBadge): head pose sliders; the mask itself is moved by press-and-hold on the settings button
  ['Настройки маски', 'Mask settings'], ['Наклон и поворот', 'Tilt and turn'], ['Наклон вниз / вверх', 'Tilt down / up'], ['Наклон влево / вправо', 'Tilt left / right'], ['Поворот влево / вправо', 'Turn left / right'],
  ['Вернуть маску на место', 'Put the mask back in place'], ['Маска не загрузилась', 'The mask failed to load'],
  ['Зажмите кнопку и перетащите, чтобы передвинуть маску', 'Press and hold the button, then drag to move the mask'],
  // uiText splits 'Сталь, царапины' at the comma, so its second half needs its own pair.
  ['царапины', 'scratches'],
  // Settings → Интерфейс: the green signal smoke behind the bosses on the Overview raid card (RaidSmoke)
  ['Дым за боссами', 'Smoke behind the bosses'], ['Сигнальный дым в карточке рейда на обзоре', 'Signal smoke on the Overview raid card'],
  ['Ширина факела', 'Plume width'], ['Темнее — светлее', 'Darker — lighter'], ['Градиент', 'Gradient'], ['Дым меняет цвет по мере подъёма', 'The smoke changes colour as it rises'], ['Цвет верхушки', 'Top colour'], ['Скорость анимации', 'Animation speed'], ['Цвет факела', 'Plume colour'],
  ['Зелёный', 'Green'], ['Красный', 'Red'], ['Оранжевый', 'Orange'], ['Жёлтый', 'Yellow'], ['Голубой', 'Light blue'], ['Фиолетовый', 'Purple'],
]
