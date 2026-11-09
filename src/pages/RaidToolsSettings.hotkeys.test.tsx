import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { setRenderLanguage } from '../i18n/renderText'
import { RaidToolsSettings } from './RaidToolsSettings'

afterEach(() => setRenderLanguage('ru'))

for (const locale of ['ru', 'en'] as const) it(`binds two keys one after the other, or a single key (${locale})`, async () => {
  setRenderLanguage(locale)
  const settings = { itemKey: 'Semicolon', collectorKey: '', itemLookup: true, minimap: true, tracking: true, playerMarker: 'arrow', screenshotsDir: '' }
  const updateSettings = vi.fn(async (patch: object) => ({ ...settings, ...patch }))
  ;(window as unknown as { tarkovDesktop: unknown }).tarkovDesktop = { experimental: {
    getSettings: async () => settings, getStatus: async () => ({}), updateSettings,
  } }
  render(<RaidToolsSettings />)
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const comboButtons = screen.getAllByRole('button', { name: locale === 'ru' ? 'Комбинация' : 'Combination' })
  fireEvent.click(comboButtons[0]!)
  fireEvent.keyDown(window, { code: 'ControlLeft', key: 'Control', ctrlKey: true })
  fireEvent.mouseDown(window, { button: 0, ctrlKey: true })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  expect(updateSettings).toHaveBeenCalledWith({ itemKey: 'Ctrl+MouseLeft' })
  const keys = () => [...document.querySelector('.exp-hotkey')!.querySelectorAll('kbd')].map((kbd) => kbd.textContent)
  expect(keys()).toEqual(['Ctrl', locale === 'ru' ? 'ЛКМ' : 'LMB'])
  // Any key may be the held one: mouse 4 held, F pressed — bound one after the other.
  fireEvent.click(screen.getByRole('button', { name: 'Ctrl' }))
  fireEvent.mouseDown(window, { button: 3 })
  fireEvent.keyDown(window, { code: 'KeyF', key: 'f' })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  expect(updateSettings).toHaveBeenLastCalledWith({ itemKey: 'Mouse4+KeyF' })
  expect(keys()).toEqual([locale === 'ru' ? 'Мышь 4' : 'Mouse 4', 'F'])
  // Back to one key: a plain key.
  fireEvent.click(screen.getAllByRole('button', { name: locale === 'ru' ? 'Клавиша' : 'Key' })[0]!)
  fireEvent.keyDown(window, { code: 'KeyF', key: 'f' })
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  expect(updateSettings).toHaveBeenLastCalledWith({ itemKey: 'KeyF' })
})
