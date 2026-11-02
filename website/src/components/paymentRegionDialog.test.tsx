import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { YooKassaPaymentDialog } from './PaymentRegionDialog'

/**
 * The ЮKassa checkout opened inside the «Яндекс» app (owner, 02.11.2026: «Да, добавь»): a hint to open the site in a
 * browser with the cabinet's link to copy; paying stays possible. Other browsers see the checkout as before.
 */
const PLAN = { id: '1m', months: 1, price: 300, currency: 'RUB', discountPercent: 0 } as const
const YANDEX_APP = 'Mozilla/5.0 (Linux; arm_64; Android 16; SM-A546B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.75 YaSearchBrowser/26.102.1 BroPP/1.0 YaSearchApp/26.102.1 webOmni Mobile Safari/537.36'
const YANDEX_BROWSER = 'Mozilla/5.0 (Linux; arm_64; Android 17; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.126 YaBrowser/26.10.2.126.00 Mobile Safari/537.36'

function openCheckout(userAgent: string) {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  render(
    <MemoryRouter>
      <YooKassaPaymentDialog plan={PLAN} methods={['sbp']} autopayAvailable={false} busy={false} error={null} onClose={() => {}} onPay={() => {}} />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('YooKassaPaymentDialog', () => {
  it('inside the «Яндекс» app: the hint and the cabinet link to copy, the payment button stays', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
    openCheckout(YANDEX_APP)
    expect(screen.getByText('Откройте сайт в браузере')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.host}/cabinet`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать ссылку' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/cabinet`))
    expect(screen.getByRole('button', { name: 'Перейти к оплате' })).toBeInTheDocument()
  })

  it('no hint in Яндекс Браузер and other browsers', () => {
    openCheckout(YANDEX_BROWSER)
    expect(screen.getByRole('button', { name: 'Перейти к оплате' })).toBeInTheDocument()
    expect(screen.queryByText('Откройте сайт в браузере')).not.toBeInTheDocument()
  })
})
