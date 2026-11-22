import { describe, expect, it } from 'vitest'
import { CRASH_RELOADS, RELOAD_WINDOW_MS, shouldReloadAfterCrash, shouldReportLoadFailure, startNotes, startNotesScript } from './startDiagnostics'

describe('a start that cannot show its page says so (owner, 23.11.2026)', () => {
  it('reports the app page that never opened, not a replaced load, a frame inside it or a later navigation', () => {
    expect(shouldReportLoadFailure({ code: -6, isMainFrame: true, loaded: false })).toBe(true)
    expect(shouldReportLoadFailure({ code: -3, isMainFrame: true, loaded: false })).toBe(false)
    expect(shouldReportLoadFailure({ code: -6, isMainFrame: false, loaded: false })).toBe(false)
    expect(shouldReportLoadFailure({ code: -6, isMainFrame: true, loaded: true })).toBe(false)
  })

  it('loads the page again after its process ended, only after it drew, never on a clean end, a couple of times a minute', () => {
    const now = 1_000_000
    expect(shouldReloadAfterCrash('crashed', true, [], now)).toBe(true)
    expect(shouldReloadAfterCrash('crashed', false, [], now)).toBe(false)
    expect(shouldReloadAfterCrash('clean-exit', true, [], now)).toBe(false)
    const recent = Array.from({ length: CRASH_RELOADS }, (_, index) => now - index * 1000)
    expect(shouldReloadAfterCrash('oom', true, recent, now)).toBe(false)
    expect(shouldReloadAfterCrash('oom', true, recent.map((at) => at - RELOAD_WINDOW_MS), now)).toBe(true)
  })

  it('hands the page the version, Windows, the graphics card and the preload error', () => {
    const notes = startNotes({ version: '0.6.0-335', system: 'Windows 10.0.26100 x64', gpu: { gpu_compositing: 'enabled', '2d_canvas': 'enabled', webgl: 'enabled' }, softwareDrawing: true, preloadError: 'boom' })
    expect(notes).toEqual([
      'Версия 0.6.0-335 · Windows 10.0.26100 x64',
      'Видеокарта: gpu_compositing: enabled, 2d_canvas: enabled, webgl: enabled · рисует без видеокарты',
      'Ошибка preload: boom',
    ])
    expect(startNotes({ version: '1', system: 'Windows', softwareDrawing: false })[1]).toBe('Видеокарта: нет данных')
    const page: { __raidosStartNotes?: string[] } = {}
    new Function('window', startNotesScript(['a "quoted" line', '</script>']))(page)
    expect(page.__raidosStartNotes).toEqual(['a "quoted" line', '</script>'])
  })
})
