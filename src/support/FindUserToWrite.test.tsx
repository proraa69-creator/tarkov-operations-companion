import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FindUserToWrite } from './FindUserToWrite'

/** «Написать пользователю» in the owner's «Чаты» (owner, 15.10.2026): search by e-mail through the owner app's gateway. */
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'tarkovDesktop') })

describe('«Написать пользователю»', () => {
  it('searches by part of the e-mail and opens the picked account\'s conversation', async () => {
    const serviceRequest = vi.fn(async (_method: string, path: string): Promise<unknown> => (path.includes('q=kaz')
      ? { users: [{ id: 'a'.repeat(24), email: 'kazakh@example.com', nickname: 'Steppe_Wolf', country: 'KZ', region: 'cis', subscription: { status: 'active' }, hasThread: false }] }
      : { users: [] }))
    Object.assign(window, { tarkovDesktop: { serviceRequest } })
    const onPick = vi.fn()
    const user = userEvent.setup()
    render(<FindUserToWrite onPick={onPick} />)
    await user.click(screen.getByRole('button', { name: 'Написать пользователю' }))
    await user.type(screen.getByRole('searchbox', { name: 'Почта пользователя' }), 'k')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(serviceRequest).not.toHaveBeenCalled()
    await user.type(screen.getByRole('searchbox', { name: 'Почта пользователя' }), 'az')
    const found = await screen.findByRole('button', { name: /kazakh@example\.com/ })
    expect(found).toHaveTextContent('Steppe_Wolf · KZ · СНГ · Подписка')
    expect(serviceRequest).toHaveBeenLastCalledWith('GET', '/v1/accounts/me/admin/support/search?q=kaz')
    await user.click(found)
    expect(onPick).toHaveBeenCalledWith('a'.repeat(24))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Написать пользователю' })).toBeInTheDocument())
  })
})
