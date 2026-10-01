import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { ApproveWebLoginDialog } from './QrDialogs'

const requester = { createdAt: '2026-10-01T10:00:00.000Z', agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140', ip: '203.0.113.x', country: 'NL' }

async function openWithCode(serviceRequest: ReturnType<typeof vi.fn>) {
  Object.assign(window, { tarkovDesktop: { serviceRequest } })
  const user = userEvent.setup()
  render(<LocaleProvider><ApproveWebLoginDialog onClose={() => {}} /></LocaleProvider>)
  await user.type(screen.getByRole('textbox'), 'k7qx-m2pd')
  await user.click(screen.getByRole('button', { name: /Продолжить|Continue/ }))
  return user
}

describe('ApproveWebLoginDialog («Подтвердить вход на сайте»)', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop'); localStorage.clear() })

  it('shows who asks, from where and when before «Разрешить вход»', async () => {
    const serviceRequest = vi.fn().mockResolvedValueOnce(requester).mockResolvedValueOnce({ ok: true })
    const user = await openWithCode(serviceRequest)
    expect(serviceRequest).toHaveBeenCalledWith('POST', '/v1/accounts/me/qr-login/inspect', { code: 'K7QX-M2PD' })
    expect(await screen.findByText(/Откуда:/)).toHaveTextContent('Откуда: Нидерланды · IP 203.0.113.x')
    expect(screen.getByText(/Вход запрашивает:/)).toHaveTextContent('Chrome · Windows')
    await user.click(screen.getByRole('button', { name: 'Разрешить вход' }))
    expect(serviceRequest).toHaveBeenLastCalledWith('POST', '/v1/accounts/me/qr-login/approve', { code: 'K7QX-M2PD' })
  })

  it('in English: the country name in the interface language', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    await openWithCode(vi.fn().mockResolvedValueOnce(requester))
    expect(await screen.findByText(/From:/)).toHaveTextContent('From: Netherlands · IP 203.0.113.x')
  })

  it('says «неизвестно» without ip and country', async () => {
    await openWithCode(vi.fn().mockResolvedValueOnce({ createdAt: requester.createdAt, agent: requester.agent }))
    expect(await screen.findByText(/Откуда:/)).toHaveTextContent('Откуда: неизвестно')
  })
})
