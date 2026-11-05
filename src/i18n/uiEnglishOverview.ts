/** English for the Overview additions: the Kappa card and its «Квесты» dialog (src/components/KappaProgress.tsx). */
export const OVERVIEW_PHRASES: Array<[string, string]> = [
  ['Задания для Капы', 'Kappa-required tasks'], ['Квесты', 'Tasks'],
  ['Скупщик выдаёт «Коллекционера», когда выполнены три условия:', 'Fence gives out “The Collector” once three conditions are met:'],
  ['Лояльность 4 (корона)', 'Loyalty level 4 (crown)'],
  ['у Прапора, Терапевта, Лыжника, Миротворца, Механика, Барахольщика и Егеря', 'with Prapor, Therapist, Skier, Peacekeeper, Mechanic, Ragman and Jaeger'],
  ['Репутация у Скупщика от +3,0', 'Fence reputation +3.0 or higher'], ['(карма Дикого)', '(Scav karma)'],
  ['4 ключевых задания', '4 key tasks'], [' · или ', ' · or '],
  ['выполнено', 'done'], ['не выполнено', 'not done'],
  // the owner's names, shown when the loaded catalog has no such task (the catalog itself comes in the app's language)
  ['Реагент. Часть 4', 'Chemical - Part 4'], ['Стрелок от бога', 'Shooter Born in Heaven'],
  ['Тарковский стрелок. Часть 4', 'The Tarkov Shooter - Part 4'], ['Шить — не тужить. Часть 4', 'Sew it Good - Part 4'],
  ['Подходит любая', 'Any of these'], ['Подходит и', 'Also accepted'],
  // «Требования рейда» without the quests put aside in «Отложенные квесты» (src/components/RaidRequirementsPanel.tsx)
  ['Не учтены отложенные квесты:', 'Deferred quests not counted:'],
  // «Отложить квест» from a right click on an item (src/components/QuestDeferDialog.tsx); the texts with numbers are built
  // in the app's language there
  ['Меню предмета', 'Item menu'], ['Отложить квест', 'Defer quest'], ['Отложить', 'Defer'], ['Убрать из избранного', 'Remove from favorites'],
  ['Этот предмет нужен квестам — какие отложить:', 'Tasks that need this item — which to defer:'],
  ['На сколько отложить', 'How long to defer'], ['По времени', 'For a time'], ['До уровня', 'Until a level'], ['Сколько дней', 'How many days'],
  ['До какого уровня', 'Until which level'], ['Свой уровень', 'Own level'], ['Уровень персонажа', 'Character level'],
  ['Уровень персонажа в этом режиме приложению пока неизвестен: он берётся с экрана игры и из профиля tarkov.dev.',
    'The app does not know your character level in this mode yet: it comes from the game screen and the tarkov.dev profile.'],
  ['Загружаем, где продаётся предмет…', 'Loading where the item is sold…'],
  ['Не удалось загрузить, где продаётся предмет. Уровень можно указать самому.', 'Could not load where the item is sold. You can set the level yourself.'],
  ['Этот предмет не продаётся на барахолке и у торговцев.', 'This item is not sold on the flea market or by traders.'],
  // «Сбор на рейд» with every quest of the map put aside (src/overview/QuestConditionsCard.tsx)
  ['Квесты этой карты со снаряжением отложены', 'The gear tasks of this map are deferred'],
  // «Предметы в избранное» in «Отложенные квесты» (src/components/DeferredQuests.tsx, src/progression/questDeferral.ts)
  ['Предметы в избранное', 'Items to favorites'],
  ['Ключи и предметы квеста, который вы отложили, сами добавляются в «Избранное» как напоминание и уходят оттуда, когда квест возвращается.',
    'The keys and items of a quest you defer go into «Favorites» by themselves, as a reminder, and leave it when the quest comes back.'],
  ['Лыжник', 'Skier'], ['Механик', 'Mechanic'], ['Егерь', 'Jaeger'], ['Барахольщик', 'Ragman'],
  // «Настроить блоки» (src/overview/)
  ['Настроить блоки', 'Arrange blocks'], ['Карточки', 'Cards'], ['Список текущих заданий', 'Current task list'],
  // the phone's «Настроить блоки» (src/overview/PhoneOverviewBlock.tsx)
  ['Пополам', 'Half width'],
  ['Удерживайте блок пальцем и перенесите на место другого — они поменяются местами. За уголок справа внизу меняется размер.', 'Hold a block and drop it on another to swap them. Drag the bottom-right corner to resize.'],
  ['Выше', 'Up'], ['Ниже', 'Down'], ['Узкий блок', 'Half width'], ['Во всю ширину', 'Full width'],
  ['Изменить размер', 'Resize'], ['Размер по умолчанию', 'Default size'],
  ['Перетащите блок мышью — остальные плавно подвинутся. Блок встаёт только туда, где сохраняет свою форму. Esc — готово.',
    'Drag a block with the mouse — the others slide out of the way. A block only goes where it keeps its shape. Esc — done.'],
  ['перемещаемый блок', 'movable block'], ['Перетащите мышью или двигайте стрелками.', 'Drag it with the mouse or move it with the arrow keys.'],
  ['сейчас скрыт', 'hidden right now'],
  ['Ивент: Вторжение Scourge', 'Event: Scourge Invasion'],
  ['Хеллоуин', 'Halloween'],
]
