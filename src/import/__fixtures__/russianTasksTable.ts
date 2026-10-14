/**
 * The Russian game's Character → «Задания» → «Побочные» table as the whole-screen pass reads it (audit P1): the top bar,
 * the tab bar with the dimmed «СЮЖЕТНЫЕ» read, the table and the bottom bar. Put together from real Tesseract output
 * (tesseract.js, rus+eng, PSM 6): the bars are those of the owner's «Тур» pass (storyPaneOcrTour.ts, EFT 1.2.0.0.47888,
 * 1920×1080), the rows those of the real 1024 px table frame (liveFrames.test.ts). Do not edit the rows by hand.
 */
export const RU_TASKS_TOP = 'Зо 0БЩЕ = BELLI 9 ЗДОРОВЬЕ Я персонж — ФУ > © ДОСТИЖЕНИЯ — ПРЕСТИЖ НАЗАД\nД СЮЖЕТНЫЕ © ПОБОЧНЫЕ С] ОПЕРАТИ Предметы для заданий на персонаже a'
export const RU_TASKS_BOTTOM = '1.2.0.0.47888 3120 &| 2\n= ГЛАВНОЕ МЕНЮ © УБЕЖИЩЕ ® ВЕ = торговцы = > БАРАХОЛКА  Фы СБОРКИ | СПРАВОЧНИК 24 СООБЩЕНИЯ 38 ОПРОС (РАСШИРЕНИЯ 3'

/** The nine rows of the real table frame: [quest id, the game's Russian title] in screen order. */
export const RU_TABLE_QUESTS: Array<[string, string]> = [
  ['q-horses', 'По коням'],
  ['q-supplier', 'Снабженец'],
  ['q-loss', 'Большая потеря'],
  ['q-fashion', 'Модный приговор'],
  ['q-tracker', 'Следопыт'],
  ['q-fuel', 'Топливный кризис'],
  ['q-aquarius', 'Операция "Водолей"'],
  ['q-first', 'Первый в очереди'],
  ['q-supply-plans', 'Планы снабжения'],
]

/** The rows as the pass read them, junk lines included (progress bars, icons). */
export const RU_TABLE_ROWS = `Класс Задание Локация Статус \\ Прогресс
6%
По коням Эпицентр. ‘активно!
9,
Снабженец Любая локация активно! 8%
6%
Большая потеря Развязка активно!
я 6%
Модный приговор Любая локация активно!
Предмет
9,
Следопыт Развязка активно! 66%
—
я 50%
Топливный кризис Развязка активно!
—
9,
‘Операция "Водолей" Таможня активно! 8%
я 50%
Первый в очереди Эпицентр активно!
—
9,
Планы снабжения Лес активно! 8%`

/** The whole frame: tabs, table, bottom bar. */
export const RU_TASKS_TABLE = `${RU_TASKS_TOP}\n${RU_TABLE_ROWS}\n${RU_TASKS_BOTTOM}\n`
