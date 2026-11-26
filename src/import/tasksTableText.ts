import { latinize } from './modeSelectScreen.js'

/** The table's column heads («Класс Задание Локация Статус», «Class Task Location Status»): never on the story pane. */
const TABLE_HEADS = /класс\s+задани[ея]\s+локаци|задани[ея]\s+локаци[яи]\s+статус|class\s+task\s+location|task\s+location\s+status|trader\s+type\s+class/i
/** A row's location cell: «Любая локация» or a map, as the table writes it. */
const LOCATION_CELL = /любая\s*локац|таможн|развязк|(?<![а-яё])лес(?![а-яё])|берег|резерв|маяк|эпицентр|улицы\s*таркова|лаборатори|лабиринт|(?<![а-яё])завод|терминал|ледокол|any\s+location|factory|customs|woods|shoreline|interchange|reserve|lighthouse|streets\s+of|(?<![a-z])the\s+lab|ground\s+zero|labyrinth|terminal|icebreaker/i
/** A row's status of a quest not handed in: never the story pane's objectives («… Выполнено»). */
const OPEN_STATUS = /активно|доступно|провалено|заблокировано|\bactive[!l1|]?(?![a-z])|\bavailable\b|\bfailed\b|\blocked\b/i

/**
 * The frame shows the Tasks table itself (the Russian or the English game): its column heads, or two rows with a location
 * cell and an open status («Лаборатория активно!»). The story pane never shows either. Such a frame is the table even when
 * one of its words made it look like a story pane (report 232: «Лаборатория» in a row of «Побочные» was taken for the
 * pane's «ИСТОРИЯ», and every row of the table was passed over). Used by the main process (electron/screenOcr.ts) and the
 * renderer (src/import/storyScan.ts tasksScreenKind).
 */
export function isTasksTableText(text: string) {
  if (TABLE_HEADS.test(text) || TABLE_HEADS.test(latinize(text))) return true
  const rows = text.split(/\r?\n/).filter((line) => {
    const lower = line.toLowerCase()
    // A title beside them: letters left once the cells are taken out.
    return OPEN_STATUS.test(lower) && LOCATION_CELL.test(lower)
      && lower.replace(OPEN_STATUS, ' ').replace(LOCATION_CELL, ' ').replace(/[^a-zа-яё]+/g, '').length >= 3
  })
  return rows.length >= 2
}
