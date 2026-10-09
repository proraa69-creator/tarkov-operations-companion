import { describe, expect, it } from 'vitest'
import { gameInTaskList } from './gameProcess'

describe('gameInTaskList', () => {
  it('finds the game in tasklist CSV output', () => {
    expect(gameInTaskList('"EscapeFromTarkov.exe","12345","Console","1","6 543 210 K"\r\n')).toBe(true)
  })
  it('no game: tasklist prints an INFO line (any language)', () => {
    expect(gameInTaskList('INFO: No tasks are running which match the specified criteria.\r\n')).toBe(false)
    expect(gameInTaskList('ИНФОРМАЦИЯ: Задачи, отвечающие заданным критериям, отсутствуют.\r\n')).toBe(false)
    expect(gameInTaskList('')).toBe(false)
  })
})
