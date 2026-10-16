import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAccessPanel } from './ClaudeAccessPanel'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'

/** «Доступ Claude к заявкам» (owner, 14.10.2026: «2 вариант да»): the owner's read-only key for the players' reports. */
const KEY_PATH = '/v1/accounts/me/admin/requests-key'
const CREATED = '2026-10-14T10:05:00.000Z'
const HINT = 'Добавьте его в настройки облачной среды Claude как RAIDOS_REQUESTS_KEY (меню среды в заголовке сессии → Edit → Network secrets). В чат ключ не вставляйте.'

/** The owner app's gateway with the server's key: GET the state, POST a new key, DELETE it. */
function mockServer(initial: { active: boolean; createdAt?: string; lastUsedAt?: string } = { active: false }, edition = 'owner') {
  let current = initial
  const keys: string[] = []
  const calls: string[] = []
  const serviceRequest = vi.fn(async (method: string, path: string) => {
    calls.push(`${method} ${path}`)
    if (path !== KEY_PATH) throw new Error('Неизвестный запрос сервиса')
    if (method === 'GET') return current
    if (method === 'POST') {
      keys.push(`rok_${'k'.repeat(42)}${keys.length + 1}`)
      current = { active: true, createdAt: CREATED }
      return { key: keys.at(-1), createdAt: CREATED }
    }
    current = { active: false }
    return null
  })
  Object.assign(window, { tarkovDesktop: { edition, isDesktop: true, serviceRequest } })
  return { calls, keys, serviceRequest }
}

/** Every value the page keeps in the browser's storage. */
const stored = () => [localStorage, sessionStorage].flatMap((storage) => Object.keys(storage).map((name) => `${name}=${storage.getItem(name)}`)).join('\n')

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'tarkovDesktop')
  localStorage.clear()
  sessionStorage.clear()
  setRenderLanguage('ru')
  vi.restoreAllMocks()
})

describe('«Доступ Claude к заявкам»', () => {
  it('creates a key and shows it once, read-only, with «Скопировать» and where to put it; it is kept nowhere', async () => {
    const server = mockServer()
    const user = userEvent.setup()
    const { unmount } = render(<ClaudeAccessPanel />)
    expect(screen.getByRole('heading', { name: 'Доступ Claude к заявкам' })).toBeInTheDocument()
    expect(screen.getByText('Ключ только для чтения заявок: тексты, скриншоты, версии. Почт и аккаунтов в нём нет.')).toBeInTheDocument()
    expect(await screen.findByText('Ключа нет')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отозвать' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Создать ключ' }))
    const field = await screen.findByRole('textbox', { name: 'Новый ключ' })
    const key = server.keys[0]!
    expect(field).toHaveValue(key)
    expect(field).toHaveAttribute('readonly')
    expect(screen.getByText(HINT)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Ключ создан .+ · ещё не использовался$/)

    await user.click(screen.getByRole('button', { name: 'Скопировать' }))
    expect(await navigator.clipboard.readText()).toBe(key)
    expect(screen.getByRole('button', { name: 'Скопировано' })).toBeInTheDocument()
    expect(stored()).not.toContain(key.slice(4))

    // «Скрыть ключ», or closing the panel: the key is gone for good; the state stays.
    await user.click(screen.getByRole('button', { name: 'Скрыть ключ' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Заменить ключ' })).toBeInTheDocument()
    unmount()
    render(<ClaudeAccessPanel />)
    expect(await screen.findByText(/^Ключ создан/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain(key.slice(4))
    expect(server.calls).toEqual([`GET ${KEY_PATH}`, `POST ${KEY_PATH}`, `GET ${KEY_PATH}`])
  })

  it('replacing asks first; revoking removes the key and says so', async () => {
    const server = mockServer({ active: true, createdAt: CREATED, lastUsedAt: '2026-10-14T11:30:00.000Z' })
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<ClaudeAccessPanel />)
    expect(await screen.findByRole('status')).toHaveTextContent(/^Ключ создан .+ · последнее чтение .+$/)

    await user.click(screen.getByRole('button', { name: 'Заменить ключ' }))
    expect(confirm).toHaveBeenLastCalledWith('Заменить ключ? Старый ключ сразу перестанет работать.')
    expect(server.calls.filter((call) => call.startsWith('POST'))).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Заменить ключ' }))
    expect(await screen.findByRole('textbox', { name: 'Новый ключ' })).toHaveValue(server.keys[0])

    await user.click(screen.getByRole('button', { name: 'Отозвать' }))
    expect(await screen.findByText('Ключ отозван')).toBeInTheDocument()
    expect(screen.getByText('Ключа нет')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать ключ' })).toBeInTheDocument()
    expect(server.calls.slice(-2)).toEqual([`DELETE ${KEY_PATH}`, `GET ${KEY_PATH}`])
  })

  it('tells a player\'s or a signed-out app what to do; the players\' app shows nothing', async () => {
    const server = mockServer()
    server.serviceRequest.mockRejectedValueOnce(new Error("Error invoking remote method 'service:request': Error: Не найдено"))
    render(<ClaudeAccessPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Ключом управляет только аккаунт владельца. Войдите в него в профиле.')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать ключ' })).toBeDisabled()
    cleanup()

    server.serviceRequest.mockResolvedValueOnce(null)
    render(<ClaudeAccessPanel />)
    expect(await screen.findByText('Войдите в аккаунт владельца, чтобы управлять ключом.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Создать ключ' })).toBeDisabled()
    cleanup()

    const client = mockServer({ active: false }, 'client')
    const { container } = render(<ClaudeAccessPanel />)
    expect(container).toBeEmptyDOMElement()
    await waitFor(() => expect(client.serviceRequest).not.toHaveBeenCalled())
  })

  it('speaks English in the English interface', async () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    mockServer()
    const user = userEvent.setup()
    render(<LocaleProvider><ClaudeAccessPanel /></LocaleProvider>)
    expect(screen.getByRole('heading', { name: 'Claude’s access to requests' })).toBeInTheDocument()
    expect(screen.getByText('A read-only key for the requests: texts, screenshots, versions. No e-mails or accounts in it.')).toBeInTheDocument()
    expect(await screen.findByText('No key')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByRole('textbox', { name: 'New key' })).toBeInTheDocument()
    expect(screen.getByText('Add it to the Claude cloud environment settings as RAIDOS_REQUESTS_KEY (the environment menu in the session header → Edit → Network secrets). Do not paste the key into the chat.')).toBeInTheDocument()
    expect(screen.getByText('The key is shown once: after the panel closes it cannot be seen again.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Key created .+ · not used yet$/)
    for (const name of ['Copy', 'Hide key', 'Replace key', 'Revoke']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })
})
