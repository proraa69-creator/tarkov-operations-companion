import { describe, expect, it } from 'vitest'
import { findTasksTable, tasksTableReading, TABLE_FIT_ROWS, type TablePicture } from './tasksTableLayout'

/**
 * A picture of the table, drawn to the numbers measured on a real frame (1440×810, EFT 1.3.0.0): the view y 105-785, rows 77.2
 * high with a dark line between them, a thumb 5 px wide on a dark track at x 947-951, the open tab's background near white.
 * The real frames were checked by hand and are not kept here: they are players' screens.
 */
function picture(options: { rows: number; offset?: number; thumb?: [number, number] | null; tab?: 'story' | 'side' | 'operational'; width?: number; height?: number }): TablePicture {
  const width = options.width ?? 1440
  const height = options.height ?? 810
  const scale = height / 810
  const data = new Uint8Array(width * height * 4)
  const fill = (x0: number, x1: number, y0: number, y1: number, value: number) => {
    for (let y = Math.round(y0 * scale); y < Math.round(y1 * scale); y += 1) {
      for (let x = Math.round(x0 * scale); x < Math.round(x1 * scale); x += 1) {
        const at = (y * width + x) * 4
        data[at] = value; data[at + 1] = value; data[at + 2] = value; data[at + 3] = 255
      }
    }
  }
  fill(0, 1440, 0, 810, 12)
  fill(0, 1440, 30, 70, 90)
  const tab = options.tab ?? 'side'
  fill(tab === 'story' ? 12 : tab === 'side' ? 172 : 322, tab === 'story' ? 160 : tab === 'side' ? 312 : 500, 30, 66, 240)
  // Rows, cut by the view at its ends.
  const offset = options.offset ?? 0
  for (let index = 0; index < options.rows; index += 1) {
    const top = 105 + index * 77.2 - offset
    const from = Math.max(105, top)
    const to = Math.min(785, top + 77.2 - 1.5)
    if (to > from) fill(190, 945, from, to, 30)
    if (top + 77.2 < 785 && top + 77.2 > 105) fill(190, 945, top + 77.2 - 1.5, top + 77.2, 2)
  }
  if (options.thumb) fill(947, 952, options.thumb[0], options.thumb[1], 200)
  return { width, height, data }
}

describe('the Tasks table on a frame (src/import/tasksTableLayout.ts)', () => {
  it('finds the rows, the thumb and the open tab of a list scrolled to its middle', () => {
    const layout = findTasksTable(picture({ rows: 64, offset: 13.19 * 77.2, thumb: [245, 337] }))!
    expect(layout.rows.length).toBeGreaterThanOrEqual(8)
    expect(layout.rows.length).toBeLessThanOrEqual(9)
    expect(layout.rowHeight).toBeCloseTo(77.2, 0)
    expect(layout.thumb).toEqual({ top: 245, bottom: 336 })
    expect([layout.atTop, layout.atBottom, layout.fits]).toEqual([false, false, false])
    expect(layout.sideTab).toBe(true)
    expect(layout.pageRows / layout.share!).toBeCloseTo(65, -1)
  })

  it('knows the thumb at each end of its track', () => {
    const top = findTasksTable(picture({ rows: 64, thumb: [105, 197] }))!
    expect([top.atTop, top.atBottom]).toEqual([true, false])
    const bottom = findTasksTable(picture({ rows: 64, offset: 64 * 77.2 - 680, thumb: [693, 785] }))!
    expect([bottom.atTop, bottom.atBottom]).toEqual([false, true])
  })

  it('a list with blank space under its last row fits: nothing is scrolled away', () => {
    const layout = findTasksTable(picture({ rows: 5, thumb: null }))!
    expect(layout.fits).toBe(true)
    expect(layout.rows).toHaveLength(5)
    expect([layout.atTop, layout.atBottom, layout.share]).toEqual([true, true, null])
  })

  it('so does a thumb as long as its track', () => {
    expect(findTasksTable(picture({ rows: 5, thumb: [105, 785] }))!.fits).toBe(true)
  })

  it('a page full of rows and no thumb found fits nothing: the thumb may be what was missed', () => {
    const layout = findTasksTable(picture({ rows: 9, thumb: null }))!
    expect(layout.rows.length).toBeGreaterThan(TABLE_FIT_ROWS - 1)
    expect([layout.fits, layout.atTop, layout.atBottom]).toEqual([false, false, false])
  })

  it('tells the other tabs from «Побочные»', () => {
    expect(findTasksTable(picture({ rows: 9, thumb: [105, 400], tab: 'operational' }))!.sideTab).toBe(false)
    expect(findTasksTable(picture({ rows: 9, thumb: [105, 400], tab: 'story' }))!.sideTab).toBe(false)
  })

  it('holds at another screen size', () => {
    const layout = findTasksTable(picture({ rows: 64, offset: 13.19 * 77.2, thumb: [245, 337], width: 1920, height: 1080 }))!
    expect(layout.rowHeight).toBeCloseTo(102.9, 0)
    expect(layout.thumb!.top).toBeCloseTo(327, -1)
    expect(layout.titles.x).toBe(263)
  })

  it('no grid of rows: no table', () => {
    const blank = picture({ rows: 0, thumb: null })
    expect(findTasksTable(blank)).toBeNull()
  })
})

describe('the cells placed on the rows', () => {
  const layout = findTasksTable(picture({ rows: 5, thumb: null }))!
  const line = (index: number, text: string) => ({ text, top: layout.rows[index]!.top + 30, bottom: layout.rows[index]!.top + 44 })

  it('puts each line on its row, one title or status a row', () => {
    const reading = tasksTableReading(layout, [line(0, 'Простая задача'), line(2, 'Честный отзыв')], [line(0, '‘активно!')], 'Поиск aa')
    expect(reading.rows.map((row) => row.title)).toEqual(['Простая задача', '', 'Честный отзыв', '', ''])
    expect(reading.rows[0]!.status).toBe('‘активно!')
    expect(reading.search).toBe('Поиск aa')
  })

  it('leaves out the cursor\'s bits on a row with a title (a real frame: «к» under «Пропавший груз»)', () => {
    const reading = tasksTableReading(layout, [line(1, 'Пропавший груз'), { ...line(1, 'к'), top: layout.rows[1]!.top + 60, bottom: layout.rows[1]!.top + 70 }], [], 'Поиск')
    expect(reading.rows[1]!.title).toBe('Пропавший груз')
  })

  it('joins a title wrapped over two lines', () => {
    const reading = tasksTableReading(layout, [line(1, 'Путь охотника. Городской'), { ...line(1, 'жандарм'), top: layout.rows[1]!.top + 50, bottom: layout.rows[1]!.top + 64 }], [], 'Поиск')
    expect(reading.rows[1]!.title).toBe('Путь охотника. Городской жандарм')
  })

  it('text in the blank space under a list that fits is a row the grid missed', () => {
    const below = layout.rows[4]!.bottom + 30
    expect(tasksTableReading(layout, [{ text: 'Каратель. Часть 5', top: below, bottom: below + 14 }], [], 'Поиск').stray).toBe(true)
    expect(tasksTableReading(layout, [{ text: '=', top: below, bottom: below + 14 }], [], 'Поиск').stray).toBe(false)
  })
})
