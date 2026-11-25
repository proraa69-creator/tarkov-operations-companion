import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * «Ссылка на новый пароль» (owner, 26.11.2026: a player got no e-mail code — «Я ему скидываю ссылку, он её открывает…
 * ввести новый пароль 2 раза»): raidos.app/reset#link=<challengeId>.<code> asks only for the new password, twice.
 */
const mocks = vi.hoisted(() => ({ adopt: vi.fn(), emailReset: vi.fn(), status: 'signed-out' }))

vi.mock('../auth', () => ({
  useAuth: () => ({ status: mocks.status, token: null, account: null, error: null, reload: vi.fn(), logout: vi.fn(), login: vi.fn(), register: vi.fn(), setAccount: vi.fn(), adopt: mocks.adopt }),
}))
vi.mock('../api', async (original) => {
  const actual = await original<typeof import('../api')>()
  const answers: Record<string, unknown> = {
    authConfig: () => Promise.resolve({ smsEnabled: false, emailEnabled: true, codeLength: 6, codeTtlSeconds: 600, resendSeconds: 60, countries: [] }),
    emailReset: mocks.emailReset,
  }
  const api = new Proxy({}, { get: (_target, key: string) => answers[key] ?? (() => new Promise(() => {})) })
  return { ...actual, api }
})

const { ResetPasswordPage } = await import('./ResetPasswordPage')
const { parsePasswordLink } = await import('../components/EmailAuth')
const { ApiError } = await import('../api')

const ID = 'Ab3_-'.repeat(6) + 'Zz'
const LINK = `#link=${ID}.042137`

function open(hash = LINK) {
  render(
    <MemoryRouter initialEntries={[`/reset${hash}`]}>
      <Routes>
        <Route path="/reset" element={<ResetPasswordPage />} />
        <Route path="/cabinet" element={<p>cabinet</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Сохранить новый пароль' }))

describe('password link', () => {
  afterEach(() => { cleanup(); mocks.adopt.mockReset(); mocks.emailReset.mockReset(); mocks.status = 'signed-out' })

  it('reads only a whole link: 32 characters of the request and a 6-digit code', () => {
    expect(ID).toHaveLength(32)
    expect(parsePasswordLink(LINK)).toEqual({ challengeId: ID, code: '042137' })
    expect(parsePasswordLink('')).toBeNull()
    expect(parsePasswordLink('#subscription')).toBeNull()
    expect(parsePasswordLink(`#link=${ID.slice(1)}.042137`)).toBeNull()
    expect(parsePasswordLink(`#link=${ID}.42137`)).toBeNull()
  })

  it('asks for the new password twice, saves it with the link\'s code and signs this browser in', async () => {
    mocks.emailReset.mockResolvedValue({ token: 'new-session', account: { id: 'a1' } })
    open()
    expect(screen.queryByLabelText('E-mail')).toBeNull()
    type(/^Новый пароль/, 'correct-horse')
    type(/^Повторите пароль/, 'correct-horsE')
    save()
    expect(await screen.findByText('Пароли не совпадают.')).toBeInTheDocument()
    expect(mocks.emailReset).not.toHaveBeenCalled()
    type(/^Повторите пароль/, 'correct-horse')
    save()
    expect(await screen.findByText('cabinet')).toBeInTheDocument()
    expect(mocks.emailReset).toHaveBeenCalledWith(ID, '042137', 'correct-horse')
    expect(mocks.adopt).toHaveBeenCalledWith('new-session', { id: 'a1' })
  })

  it('a used or old link says so', async () => {
    mocks.emailReset.mockRejectedValue(new ApiError(401, 'Неверный или устаревший код'))
    open()
    type(/^Новый пароль/, 'correct-horse')
    type(/^Повторите пароль/, 'correct-horse')
    save()
    expect(await screen.findByText(/Ссылка устарела или уже использована/)).toBeInTheDocument()
    expect(mocks.adopt).not.toHaveBeenCalled()
  })

  it('opens in a signed-in browser too; without a link the page stays the e-mail code form', async () => {
    mocks.status = 'ready'
    open()
    expect(screen.getByLabelText(/^Повторите пароль/)).toBeInTheDocument()
    cleanup()
    mocks.status = 'signed-out'
    open('')
    expect(await screen.findByText(/Мы пришлём на него код/)).toBeInTheDocument()
  })
})
