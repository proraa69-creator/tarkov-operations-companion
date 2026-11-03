import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScreenTuningApi, ScreenTuningView } from './screenApi'
import type { ScreenProfile } from './screenCurve'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../sync/serverSync', () => ({
  screenLiveRequest: mocks.request,
  useServerStatus: () => ({ signedIn: true, online: true }),
}))

const { applyScreenCommand, remoteState } = await import('./screenRemote')
const { MobileScreenPresets } = await import('./MobileScreenPresets')

const preset = (id: string, name: string, gamma = 1): ScreenProfile => ({ id, name, gamma, shadows: 0, highlights: 0, contrast: 0, brightness: 0, temperature: 0, tint: 0, curve: [] })
const view = (activeId: string, enabled: boolean): ScreenTuningView => ({
  settings: { presets: [], activeId, enabled, display: '', hotkey: '', cycleKey: '', builtIns: {} },
  presets: [preset('builtin-daylight', 'Как днём', 1.3), preset('own-1', 'Мой')],
  status: { available: true, gameShown: true, gameDisplay: '', displays: [], exclusive: false, applied: null, editing: false, inRaid: true, on: enabled, keysOk: { hotkey: true, cycleKey: true }, vibrance: null },
  frame: null,
})

afterEach(() => { vi.useRealTimers(); cleanup() })
beforeEach(() => { mocks.request.mockReset() })

// Owner, 31.10.2026: «при настройке на телефоне, в режиме онлайн моментально меняются настройки пресетов на пк. и можно
// выбирать пресеты с телефона… включать и выключать их».
describe('«Пресеты экрана» from the phone', () => {
  it('the PC publishes its presets and applies the phone\'s commands through its own calls', async () => {
    expect(remoteState(view('own-1', true))).toMatchObject({ activeId: 'own-1', enabled: true, on: true, inRaid: true, available: true })
    const api = { update: vi.fn(async () => view('x', true)), savePreset: vi.fn(async () => ({ ...view('x', true), savedId: 'x' })) } as unknown as ScreenTuningApi
    await applyScreenCommand(api, { type: 'select', activeId: 'own-1' })
    await applyScreenCommand(api, { type: 'enabled', enabled: false })
    await applyScreenCommand(api, { type: 'save', preset: preset('own-1', 'Мой', 1.6) })
    expect(api.update).toHaveBeenNthCalledWith(1, { activeId: 'own-1' })
    expect(api.update).toHaveBeenNthCalledWith(2, { enabled: false })
    expect(api.savePreset).toHaveBeenCalledWith(expect.objectContaining({ id: 'own-1', gamma: 1.6 }))
  })

  it('the phone shows the PC\'s presets and sends a choice, on / off and a tuned slider at once', async () => {
    const state = remoteState(view('builtin-daylight', false))
    let answered = false
    mocks.request.mockImplementation(async (method: string, path: string) => {
      if (method === 'GET' && path.startsWith('/v1/live/screen')) {
        if (answered) return new Promise(() => {})
        answered = true
        return { version: 2, pc: { state, at: Date.now() } }
      }
      return { id: 1 }
    })
    render(<MobileScreenPresets />)
    expect(await screen.findByText('ПК на связи')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Пресет выключен/ }))
    expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/live/screen/command', { type: 'enabled', enabled: true })
    expect(screen.getByRole('button', { name: /Пресет включён/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Мой/ }))
    expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/live/screen/command', { type: 'select', activeId: 'own-1' })
    vi.useFakeTimers()
    fireEvent.change(screen.getByRole('slider', { name: /Гамма/ }), { target: { value: '1.8' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/live/screen/command', { type: 'save', preset: expect.objectContaining({ id: 'own-1', gamma: 1.8 }) })
  })

  it('without the PC the phone says so and nothing can be pressed', async () => {
    mocks.request.mockResolvedValueOnce({ version: 1, pc: null }).mockImplementation(() => new Promise(() => {}))
    render(<MobileScreenPresets />)
    expect(await screen.findByText('ПК не в сети')).toBeInTheDocument()
    expect(screen.getByText('Откройте Raid OS на ПК с тем же аккаунтом')).toBeInTheDocument()
  })
})
