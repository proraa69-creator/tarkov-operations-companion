import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// «Подписка Raid OS» through Apple in the iPhone app (owner, 09.11.2026: «оплата была и в Apple, и на сайте»).
const TOKEN = '8f5f65e2-e296-4acf-ba8c-6bc3c986cc11'
const mocks = vi.hoisted(() => ({
  status: null as import('../electron').ServerAccountStatus | null,
  request: vi.fn(),
  refresh: vi.fn(async () => {}),
  store: {
    getProducts: vi.fn(),
    purchaseProduct: vi.fn(),
    restorePurchases: vi.fn(async () => {}),
    getPurchases: vi.fn(async () => ({ purchases: [] as Array<{ jwsRepresentation?: string }> })),
    manageSubscriptions: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
    getStorefront: vi.fn(async () => ({ countryCode: 'RUS' })),
  },
  openWebsite: vi.fn(),
}))
vi.mock('../platform', async (original) => ({ ...await original<typeof import('../platform')>(), isIosApp: () => true, APP_STORE_BUILD: true }))
vi.mock('../sync/serverSync', async (original) => ({
  ...await original<typeof import('../sync/serverSync')>(),
  useServerAccount: () => ({ status: mocks.status, checking: false, available: true, refresh: mocks.refresh, login: vi.fn(), logout: vi.fn() }),
}))
vi.mock('./useAccountNickname', () => ({ useAccountNickname: () => 'Reviewer' }))
vi.mock('../sync/webAccount', async (original) => ({ ...await original<typeof import('../sync/webAccount')>(), webServiceRequest: mocks.request }))
vi.mock('@capgo/native-purchases', () => ({ NativePurchases: mocks.store, PURCHASE_TYPE: { INAPP: 'inapp', SUBS: 'subs' } }))
vi.mock('./accountActions', async (original) => ({ ...await original<typeof import('./accountActions')>(), openWebsite: mocks.openWebsite }))

const { Paywall } = await import('./Paywall')
const { parseIapInfo, periodText, savingPercent, sendOutcome } = await import('./appleIap')

const signedIn = { signedIn: true, online: true, serverUrl: 'https://raidos.app', persistent: true, email: 'reviewer@example.com', subscription: { status: 'inactive' as const } }
const PRODUCTS = [{ id: 'com.tarkovoperator.app.sub.1m', months: 1 }, { id: 'com.tarkovoperator.app.sub.12m', months: 12 }]
/** The server: GET /v1/apple/iap and POST /v1/apple/transactions. */
function server(iap: unknown, sent: unknown = { results: [{ status: 'applied' }] }) {
  mocks.request.mockImplementation(async (method: string, path: string) => (path === '/v1/apple/iap' ? iap : path === '/v1/apple/transactions' ? sent : null))
}
const paywall = () => render(<MemoryRouter><Paywall access={{ state: 'locked', reason: 'subscription' }} /></MemoryRouter>)

beforeEach(() => {
  mocks.status = signedIn
  mocks.request.mockReset()
  mocks.refresh.mockClear()
  for (const fn of Object.values(mocks.store)) fn.mockClear()
  mocks.store.getProducts.mockResolvedValue({ products: [
    { identifier: 'com.tarkovoperator.app.sub.1m', title: 'Raid OS — 1 month', priceString: '$7.00', price: 7 },
    { identifier: 'com.tarkovoperator.app.sub.12m', title: 'Raid OS — 12 months', priceString: '$60.00', price: 60 },
  ] })
  mocks.store.getPurchases.mockResolvedValue({ purchases: [] })
  mocks.store.getStorefront.mockResolvedValue({ countryCode: 'RUS' })
  mocks.openWebsite.mockClear()
})
afterEach(cleanup)

describe('the subscription through Apple', () => {
  it('off on the server: nothing about a subscription or a price', async () => {
    server({ enabled: false, products: [] })
    paywall()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('GET', '/v1/apple/iap'))
    expect(document.body.textContent).not.toMatch(/₽|Подписк|подписк|Восстановить покупки/)
    expect(mocks.store.getProducts).not.toHaveBeenCalled()
  })

  it('on: the plans with StoreKit\'s own prices, the auto-renewal terms, the terms of use and privacy links, «Восстановить покупки»', async () => {
    server({ enabled: true, products: PRODUCTS, appAccountToken: TOKEN, siteLinkStorefronts: ['USA'] })
    paywall()
    expect(await screen.findByRole('button', { name: /1 месяц.*\$7\.00/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /12 месяцев.*−29 %.*\$60\.00/ })).toBeInTheDocument()
    expect(mocks.store.getProducts).toHaveBeenCalledWith({ productIdentifiers: PRODUCTS.map((product) => product.id), productType: 'subs' })
    expect(screen.getByText(/продлевается автоматически/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Условия использования' })).toHaveAttribute('href', 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')
    expect(screen.getAllByRole('link', { name: 'Политика конфиденциальности' })[0]).toHaveAttribute('href', 'https://raidos.app/legal/privacy')
    expect(screen.getByRole('button', { name: /Восстановить покупки/ })).toBeInTheDocument()
    // Nothing points to paying on the site (guideline 3.1.1).
    expect(document.body.textContent).not.toMatch(/raidos\.app|на сайте|ЮKassa|СБП/)
  })

  it('a purchase: Apple\'s sheet with the account\'s token, the signed transaction to the server, the access refreshed', async () => {
    server({ enabled: true, products: PRODUCTS, appAccountToken: TOKEN, siteLinkStorefronts: ['USA'] })
    mocks.store.purchaseProduct.mockResolvedValue({ transactionId: '1', jwsRepresentation: 'a.b.c' })
    paywall()
    fireEvent.click(await screen.findByRole('button', { name: /1 месяц/ }))
    expect(await screen.findByText('Подписка оформлена')).toBeInTheDocument()
    expect(mocks.store.purchaseProduct).toHaveBeenCalledWith({ productIdentifier: 'com.tarkovoperator.app.sub.1m', productType: 'subs', quantity: 1, appAccountToken: TOKEN })
    expect(mocks.request).toHaveBeenCalledWith('POST', '/v1/apple/transactions', { transactions: ['a.b.c'] })
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('closing Apple\'s sheet says nothing; another account\'s subscription is named; an empty restore says so', async () => {
    server({ enabled: true, products: PRODUCTS, appAccountToken: TOKEN, siteLinkStorefronts: ['USA'] }, { results: [{ status: 'other-account' }] })
    mocks.store.purchaseProduct.mockRejectedValueOnce(new Error('User cancelled the purchase'))
    paywall()
    fireEvent.click(await screen.findByRole('button', { name: /1 месяц/ }))
    await waitFor(() => expect(mocks.store.purchaseProduct).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Восстановить покупки/ }))
    expect(await screen.findByText('Покупок для восстановления нет.')).toBeInTheDocument()

    mocks.store.getPurchases.mockResolvedValue({ purchases: [{ jwsRepresentation: 'x.y.z' }] })
    fireEvent.click(screen.getByRole('button', { name: /Восстановить покупки/ }))
    expect(await screen.findByText('Эта подписка Apple оформлена на другой аккаунт Raid OS.')).toBeInTheDocument()
    expect(mocks.store.restorePurchases).toHaveBeenCalled()
  })

  it('«Raid OS для Windows» with raidos.app/pc while the server allows it, purchases on or off — and never a word about paying', async () => {
    server({ enabled: false, products: [], pcAppLink: true })
    paywall()
    const link = await screen.findByRole('link', { name: /Скачать для Windows/ })
    expect(link).toHaveAttribute('href', 'https://raidos.app/pc')
    expect(screen.getByText('Raid OS для Windows')).toBeInTheDocument()
    const card = link.closest('.pc-app')
    expect(card?.textContent).not.toMatch(/оплат|Оплат|подписк|Подписк|доступ|₽|цен/)
    cleanup()

    server({ enabled: true, products: PRODUCTS, appAccountToken: TOKEN, siteLinkStorefronts: [], pcAppLink: true })
    paywall()
    await screen.findByRole('button', { name: /1 месяц/ })
    expect(screen.getByRole('link', { name: /Скачать для Windows/ })).toBeInTheDocument()
    cleanup()

    // Turned off on the server (APPLE_PC_APP_LINK=0).
    server({ enabled: false, products: [], pcAppLink: false })
    paywall()
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('GET', '/v1/apple/iap'))
    expect(screen.queryByRole('link', { name: /Скачать для Windows/ })).not.toBeInTheDocument()
  })

  it('reads the server\'s answers', () => {
    expect(parseIapInfo(null)).toEqual({ enabled: false, products: [], siteLinkStorefronts: [], pcAppLink: false })
    expect(parseIapInfo({ enabled: false, products: [], pcAppLink: true })).toEqual({ enabled: false, products: [], siteLinkStorefronts: [], pcAppLink: true })
    expect(parseIapInfo({ enabled: true, products: PRODUCTS, appAccountToken: 'not-a-uuid', siteLinkStorefronts: ['USA', 'us', 7] })).toEqual({ enabled: true, products: PRODUCTS, siteLinkStorefronts: ['USA'], pcAppLink: false })
    expect(sendOutcome({ results: [{ status: 'ignored' }, { status: 'applied' }] })).toBeUndefined()
    expect(sendOutcome({ results: [{ status: 'expired' }] })).toBe('Подписка Apple закончилась. Оформите её снова.')
    expect(sendOutcome({ results: [{ status: 'revoked' }] })).toBe('Apple вернул деньги за эту покупку: подписка не действует.')
    expect(sendOutcome({ results: [] })).toBe('Не удалось проверить покупку. Нажмите «Восстановить покупки».')
    expect([1, 3, 6, 12].map(periodText)).toEqual(['1 месяц', '3 месяца', '6 месяцев', '12 месяцев'])
    // The site's global prices: $7 / $19 / $35 / $60 — 10, 17 and 29 % off month by month.
    const site = [{ months: 1, amount: 7 }, { months: 3, amount: 19 }, { months: 6, amount: 35 }, { months: 12, amount: 60 }]
    expect(site.map((entry) => savingPercent(entry, site))).toEqual([0, 10, 17, 29])
    expect(savingPercent({ months: 12, amount: 60 }, [{ months: 12, amount: 60 }])).toBe(0)
  })
})
