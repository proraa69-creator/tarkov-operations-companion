import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../platform', async (original) => ({ ...(await original<typeof import('../platform')>()), isIosApp: () => true, isNative: () => true }))
vi.mock('@capacitor/app', () => ({ App: { addListener: async () => ({ remove: async () => undefined }) } }))

import { IphoneUpdateBanner } from './IphoneUpdateBanner'
import { checkIphoneUpdate, resetIphoneUpdate } from './iphoneUpdate'
import { NewsButton } from '../news/NewsButton'

const STORE = 'https://apps.apple.com/app/raid-os/id1234567890'
const mobileJson = (body: unknown) => (async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch

afterEach(() => { cleanup(); resetIphoneUpdate(); localStorage.clear() })

// Owner, 09.11.2026: «уведомление в верхней части экрана… поверх всех окон… кнопка «Обновить» и крестик»; «в новостях…
// будет гореть, пока человек не обновит приложение. Прям там у него будет кнопка «Обновить»».
describe('the iPhone app\'s new version', () => {
  it('shows the notice on top with «Обновить» to the App Store; the cross hides it, «Обновление» keeps burning', async () => {
    vi.stubGlobal('fetch', mobileJson({ version: '0.6.0-120', iphone: { url: STORE, storeVersion: '0.6.0.120' } }))
    try {
      render(<MemoryRouter><IphoneUpdateBanner /><NewsButton /></MemoryRouter>)
      await act(async () => { await checkIphoneUpdate(mobileJson({ version: '0.6.0-120', iphone: { url: STORE, storeVersion: '0.6.0.120' } }), '0.6.0-97', false) })
      const notice = await screen.findByRole('status')
      expect(notice.parentElement).toBe(document.body)
      expect(notice).toHaveTextContent('Вышла новая версия 0.6.0.120')
      expect(screen.getByRole('link', { name: 'Обновить' })).toHaveAttribute('href', STORE)

      const news = screen.getByRole('button', { name: /Обновление/ })
      expect(news).toHaveClass('has-app-update')
      await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
      expect(screen.queryByText('Вышла новая версия 0.6.0.120')).toBeNull()
      expect(news).toHaveClass('has-app-update')

      await userEvent.click(news)
      expect(await screen.findByText('Вышла новая версия приложения 0.6.0.120')).toBeInTheDocument()
      expect(screen.getAllByRole('link', { name: 'Обновить' })[0]).toHaveAttribute('href', STORE)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
