import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleSignInOffered, russianTimeZone } from '../../../src/shared/googleRegion'

// «Войти через Google» (owner, 15.11.2026: «для всех стран, кроме России»).
const mocks = vi.hoisted(() => ({ googleSignIn: vi.fn(), recordConsent: vi.fn(() => Promise.resolve()), adopt: vi.fn(), navigate: vi.fn() }))

vi.mock('../auth', () => ({ useAuth: () => ({ status: 'signed-out', token: null, account: null, adopt: mocks.adopt }) }))
vi.mock('react-router-dom', async (original) => ({ ...(await original<typeof import('react-router-dom')>()), useNavigate: () => mocks.navigate }))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  return { ...actual, api: { ...actual.api, googleSignIn: mocks.googleSignIn, recordConsent: mocks.recordConsent } }
})
vi.mock('../../../src/shared/googleRegion', async (original) => {
  const actual = await original<typeof import('../../../src/shared/googleRegion')>()
  return { ...actual, googleSignInOffered: vi.fn(() => true) }
})

const { GoogleSignIn } = await import('./GoogleSignIn')
const { ApiError } = await import('../api')
const region = await import('../../../src/shared/googleRegion')

let credentialCallback: ((answer: { credential?: string }) => void) | undefined
const renderButton = vi.fn((element: HTMLElement) => { element.innerHTML = '<button type="button">Google</button>' })

beforeEach(() => {
  window.google = { accounts: { id: { initialize: (options) => { credentialCallback = options.callback }, renderButton } } }
})
afterEach(() => { cleanup(); vi.clearAllMocks(); credentialCallback = undefined; delete window.google })

const account = { id: 'a1', email: 'player@example.com', kind: 'user' }

describe('the button', () => {
  it('signs an existing account in with Google\'s token', async () => {
    mocks.googleSignIn.mockResolvedValue({ token: 't1', account, created: false, referralApplied: false })
    render(<MemoryRouter><GoogleSignIn clientId="client.apps.googleusercontent.com" /></MemoryRouter>)
    await waitFor(() => expect(renderButton).toHaveBeenCalled())
    credentialCallback!({ credential: 'google-token' })
    await waitFor(() => expect(mocks.adopt).toHaveBeenCalledWith('t1', account))
    expect(mocks.googleSignIn).toHaveBeenCalledWith({ credential: 'google-token' })
    expect(mocks.recordConsent).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith('/cabinet', { replace: true })
  })

  it('a new address: the country and the documents first, then the account', async () => {
    mocks.googleSignIn.mockRejectedValueOnce(new ApiError(409, 'Укажите страну, чтобы создать аккаунт.'))
    mocks.googleSignIn.mockResolvedValueOnce({ token: 't2', account, created: true, referralApplied: false })
    render(<MemoryRouter><GoogleSignIn clientId="client.apps.googleusercontent.com" referralCode="RAID-ABCDE" /></MemoryRouter>)
    await waitFor(() => expect(renderButton).toHaveBeenCalled())
    credentialCallback!({ credential: 'google-token' })
    expect(await screen.findByText('Укажите страну, чтобы создать аккаунт.')).toBeInTheDocument()
    const proceed = screen.getByRole('button', { name: 'Продолжить' })
    expect(proceed).toBeDisabled()
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Страна' }))
    await user.type(screen.getByRole('combobox', { name: 'Поиск страны' }), 'Герман')
    await user.click(screen.getByRole('option', { name: /Германия/ }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Продолжить' }))
    await waitFor(() => expect(mocks.adopt).toHaveBeenCalledWith('t2', account))
    expect(mocks.googleSignIn).toHaveBeenLastCalledWith({ credential: 'google-token', country: 'DE', referralCode: 'RAID-ABCDE' })
    expect(mocks.recordConsent).toHaveBeenCalledWith('t2', 'registration', expect.any(String))
  })

  it('no button without the server\'s Google client or on a device in a Russian time zone', () => {
    const { container, rerender } = render(<MemoryRouter><GoogleSignIn /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
    vi.mocked(region.googleSignInOffered).mockReturnValue(false)
    rerender(<MemoryRouter><GoogleSignIn clientId="client.apps.googleusercontent.com" /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Russian time zones', () => {
  it('Moscow, Kaliningrad, Vladivostok and Crimea count; Minsk, Almaty, Berlin and Bangkok do not', () => {
    for (const zone of ['Europe/Moscow', 'Europe/Kaliningrad', 'Asia/Vladivostok', 'Europe/Simferopol']) expect(russianTimeZone(zone)).toBe(true)
    for (const zone of ['Europe/Minsk', 'Asia/Almaty', 'Europe/Berlin', 'Asia/Bangkok']) expect(russianTimeZone(zone)).toBe(false)
    expect(googleSignInOffered).toBeDefined()
  })
})
