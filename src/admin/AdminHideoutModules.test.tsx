import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HideoutStation } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { BITCOIN_FARM, GYM } from '../hideout/hideoutModules'
import { hideoutModules, setHideoutModules } from '../hideout/hideoutModulesStore'
import { AdminHideoutModules, HIDEOUT_MODULES_PATH } from './AdminHideoutModules'

const station = (id: string, name: string): HideoutStation => ({ id, name, level: 0, status: 'locked', requirements: [], bonus: '', levels: [{ level: 1, requirements: [], bonus: '' }] }) as HideoutStation
vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { hideout: [station(GYM, 'Спортзал'), station(BITCOIN_FARM, 'Биткоин-ферма')] } }) }))

const fakeServer = () => {
  let modules: unknown = null
  return vi.fn(async (method: 'GET' | 'POST' | 'PUT', _path: string, sent?: unknown) => {
    const body = sent as { mode: string; open: string[]; hidden: string[] } | undefined
    if (method === 'PUT' && body) {
      const { mode, ...lists } = body
      modules = lists.open.length || lists.hidden.length ? { modes: { [mode]: lists }, updatedAt: '2026-11-20T10:00:00.000Z', updatedBy: 'owner@example.com' } : null
    }
    return { modules }
  })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  setRenderLanguage('ru')
  setHideoutModules(null)
})

describe('«Админ панель» → «Модули убежища»', () => {
  it('nothing set: every module as in the game; the gym and the bitcoin farm from the start in Season, saved for everybody', async () => {
    const user = userEvent.setup()
    const request = fakeServer()
    render(<LocaleProvider><AdminHideoutModules request={request} /></LocaleProvider>)
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', HIDEOUT_MODULES_PATH))
    expect(screen.getByRole('tab', { name: 'Сезон' })).toHaveAttribute('aria-selected', 'true')
    const gym = screen.getByRole('radiogroup', { name: 'Спортзал' })
    await waitFor(() => expect(within(gym).getByRole('radio', { name: 'Как в игре' })).toBeEnabled())
    expect(within(gym).getByRole('radio', { name: 'Как в игре' })).toHaveAttribute('aria-checked', 'true')
    const save = screen.getByRole('button', { name: 'Сохранить' })
    expect(save).toBeDisabled()

    await user.click(within(gym).getByRole('radio', { name: 'Со старта' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Биткоин-ферма' })).getByRole('radio', { name: 'Со старта' }))
    await user.click(save)
    expect(await screen.findByRole('status')).toHaveTextContent('Сохранено')
    expect(request).toHaveBeenCalledWith('PUT', HIDEOUT_MODULES_PATH, { mode: 'seasonal', open: [BITCOIN_FARM, GYM].sort(), hidden: [] })
    // this app shows it at once
    expect(hideoutModules()?.modes.seasonal?.open).toEqual([BITCOIN_FARM, GYM].sort())
    expect(save).toBeDisabled()
  })

  it('turns a module off in one mode only', async () => {
    const user = userEvent.setup()
    const request = fakeServer()
    render(<LocaleProvider><AdminHideoutModules request={request} /></LocaleProvider>)
    await waitFor(() => expect(request).toHaveBeenCalledWith('GET', HIDEOUT_MODULES_PATH))
    await user.click(screen.getByRole('tab', { name: 'PvE' }))
    const farm = screen.getByRole('radiogroup', { name: 'Биткоин-ферма' })
    await waitFor(() => expect(within(farm).getByRole('radio', { name: 'Выключен' })).toBeEnabled())
    await user.click(within(farm).getByRole('radio', { name: 'Выключен' }))
    await user.click(screen.getByRole('button', { name: 'Сохранить' }))
    await screen.findByRole('status')
    expect(request).toHaveBeenCalledWith('PUT', HIDEOUT_MODULES_PATH, { mode: 'pve', open: [], hidden: [BITCOIN_FARM] })
    expect(request.mock.calls.filter(([method]) => method === 'PUT')).toHaveLength(1)
  })

  it('reads in English', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    setRenderLanguage('en')
    render(<LocaleProvider><AdminHideoutModules request={fakeServer()} /></LocaleProvider>)
    expect(screen.getByText('Hideout modules')).toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: 'From the start' })).toHaveLength(26)
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})
