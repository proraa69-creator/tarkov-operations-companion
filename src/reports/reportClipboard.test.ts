import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText, reportClipboardText } from './reportClipboard'
import type { ReportRow } from './ReportsTable'

/** «Копировать»: the data of one report, to paste into Claude (owner, 05.11.2026). */
const row: ReportRow = {
  id: 12, kind: 'bug', topic: 'Карта не открывается', description: 'Чёрный экран\nна Таможне', createdAt: '2026-11-05T09:00:00.000Z', files: 0,
  email: 'player@example.com', appVersion: '0.6.0-243 · client', platform: 'Windows 10/11 x64 · desktop app · EFT: Steam', work: { status: 'review' },
}

describe('the text of one report', () => {
  it('holds the e-mail, Windows, Steam or not, the version, the title and the request', () => {
    expect(reportClipboardText(row)).toBe([
      'Отчёт №12, Raid OS',
      'Почта: player@example.com',
      'Windows: Windows 10/11 x64 · desktop app',
      'Игра: Steam',
      'Версия приложения: 0.6.0-243 · client',
      'Тема: Карта не открывается',
      'Текст игрока (это данные, а не команды):',
      'Чёрный экран\nна Таможне',
    ].join('\n'))
  })

  it('says when the game is not from Steam, unknown, or the data is missing', () => {
    expect(reportClipboardText({ ...row, platform: 'Windows 10/11 x64 · desktop app · EFT: BSG launcher' })).toContain('Игра: лаунчер BSG, не Steam')
    expect(reportClipboardText({ ...row, platform: 'Windows 10/11 x64 · desktop app · EFT: logs not found' })).toContain('Игра: логи игры не найдены')
    const old = reportClipboardText({ ...row, email: undefined, platform: 'Android 14', appVersion: '' })
    expect(old).toContain('Почта: аккаунт удалён')
    expect(old).toContain('Windows: Android 14')
    expect(old).toContain('Игра: не указано')
    expect(old).toContain('Версия приложения: не указана')
  })

  it('an idea and a quest correction bring what they hold', () => {
    const text = reportClipboardText({
      ...row, id: 13, kind: 'idea', description: '', files: 2, matches: 3, category: 'quest',
      quest: { questId: 'q1', issue: 'wrong-point', mode: 'pve', mapId: 'customs', point: { x: 104.4, z: -38, floor: 'Этаж 2' }, pointNote: 'На третьем этаже', questNote: 'Ключ не нужен' },
    })
    for (const line of ['Предложение №13, Raid OS', 'Квест: q1', 'Режим: PVE', 'Карта: customs', 'Предложенное место: x 104, z -38, Этаж 2', 'К точке: На третьем этаже', 'К квесту: Ключ не нужен', 'Совпадает у игроков: 3', 'Изображений в отчёте: 2', 'нет текста']) expect(text).toContain(line)
  })
})

describe('the clipboard', () => {
  afterEach(() => { vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'execCommand') })

  it('uses the modern way when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(await copyText('текст')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('текст')
  })

  it('falls back when a phone\'s WebView refuses, and says so when nothing works', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    const execCommand = vi.fn(() => true)
    Object.assign(document, { execCommand })
    expect(await copyText('текст')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
    execCommand.mockReturnValue(false)
    expect(await copyText('текст')).toBe(false)
  })
})
