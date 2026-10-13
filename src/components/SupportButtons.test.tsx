import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportButtons } from './SupportButtons'
import { describePlatform, SUPPORT_TELEGRAM_URL } from '../app/support'

const signedIn = { signedIn: true, email: 'player@example.com', kind: 'user', online: true, serverUrl: 'https://raidos.app', persistent: true }
const signedOut = { signedIn: false, online: true, serverUrl: 'https://raidos.app', persistent: true }
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

function mockDesktop(status: unknown, answer: unknown = { id: 7, createdAt: '2026-10-06T10:00:00.000Z' }) {
  const serviceRequest = vi.fn().mockResolvedValue(answer)
  Object.assign(window, { tarkovDesktop: { isDesktop: true, serviceRequest, account: { status: vi.fn().mockResolvedValue(status), login: vi.fn(), logout: vi.fn() } } })
  return serviceRequest
}

describe('SupportButtons', () => {
  afterEach(() => { Reflect.deleteProperty(window, 'tarkovDesktop') })

  it('asks before «Связаться» opens the owner\'s Telegram channel: «Да» goes there, «Нет» stays', async () => {
    mockDesktop(signedOut)
    const user = userEvent.setup()
    render(<SupportButtons variant="panel" />)
    expect(screen.queryByRole('link', { name: 'Связаться' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Связаться' }))
    const dialog = await screen.findByRole('dialog', { name: 'Связаться с нами' })
    expect(dialog).toHaveTextContent('Перейти в Telegram-канал Raid OS, чтобы написать нам?')
    const yes = screen.getByRole('link', { name: 'Да' })
    expect(yes).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    expect(SUPPORT_TELEGRAM_URL).toBe('https://t.me/raidosapp')
    expect(yes).toHaveAttribute('target', '_blank')
    await user.click(screen.getByRole('button', { name: 'Нет' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Связаться' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    // «Да»: the link opens (not followed in jsdom), then the question closes.
    await user.click(screen.getByRole('button', { name: 'Связаться' }))
    const again = screen.getByRole('link', { name: 'Да' })
    again.addEventListener('click', (event) => event.preventDefault())
    await user.click(again)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('over the bug report, Escape closes only the «Связаться» question', async () => {
    mockDesktop(signedIn)
    const user = userEvent.setup()
    render(<SupportButtons variant="nav" />)
    await user.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }))
    await screen.findByLabelText('Тема')
    await user.click(within(screen.getByRole('dialog', { name: 'Сообщить об ошибке' })).getByRole('button', { name: 'Связаться' }))
    expect(await screen.findByRole('dialog', { name: 'Связаться с нами' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Связаться с нами' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Сообщить об ошибке' })).toBeInTheDocument()
  })

  it('sends a signed-in report with a screenshot and shows the thank-you state', async () => {
    const serviceRequest = mockDesktop(signedIn)
    const user = userEvent.setup({ applyAccept: false })
    render(<SupportButtons variant="nav" />)
    await user.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }))
    // A bug report starts with its category; until then the form stays folded and nothing can be sent.
    expect(await screen.findByRole('button', { name: 'Отправить отчёт' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Карта и метки' }))
    const topic = await screen.findByLabelText('Тема')
    await user.type(topic, 'Карта не открывается')
    await user.type(screen.getByLabelText(/Описание/), 'Чёрный экран на Таможне')
    await user.upload(screen.getByLabelText('Скриншоты'), new File([PNG_BYTES], 'shot.png', { type: 'image/png' }))
    expect(await screen.findByRole('img', { name: 'shot.png' })).toBeInTheDocument()
    expect(screen.getByText(/player@example.com/)).toBeInTheDocument()
    // Not an allowed type: refused with a message, the PNG stays.
    await user.upload(screen.getByLabelText('Скриншоты'), new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }))
    expect(await screen.findByText('Можно прикрепить только PNG, JPEG или WEBP.')).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Отправить отчёт' }))
    expect(await screen.findByText('Спасибо! Отчёт отправлен')).toBeInTheDocument()
    expect(serviceRequest).toHaveBeenCalledTimes(1)
    const [method, path, body] = serviceRequest.mock.calls[0] as [string, string, { kind: string; topic: string; description: string; appVersion: string; platform: string; screenshots: Array<{ data: string }> }]
    expect([method, path]).toEqual(['POST', '/v1/bug-reports'])
    expect(body.kind).toBe('bug')
    expect((body as unknown as { category: string }).category).toBe('map')
    expect(body.topic).toBe('Карта не открывается')
    expect(body.description).toBe('Чёрный экран на Таможне')
    expect(body.appVersion).toMatch(/^\d+\.\d+\.\d+(?:\.\d+)? · client$/)
    expect(body.platform).toMatch(/desktop app$/)
    expect(body.screenshots).toHaveLength(1)
    expect(body.screenshots[0]!.data).toMatch(/^data:image\/png;base64,/)
  })

  it('removes a screenshot before sending', async () => {
    mockDesktop(signedIn)
    const user = userEvent.setup()
    render(<SupportButtons variant="panel" />)
    await user.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }))
    await user.click(await screen.findByRole('radio', { name: 'Другое' }))
    await user.upload(await screen.findByLabelText('Скриншоты'), new File([PNG_BYTES], 'a.png', { type: 'image/png' }))
    await user.click(await screen.findByRole('button', { name: 'Убрать скриншот a.png' }))
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull())
  })

  it('asks to sign in first and keeps Telegram available', async () => {
    const serviceRequest = mockDesktop(signedOut)
    const user = userEvent.setup()
    const { container } = render(<SupportButtons variant="panel" />)
    await user.click(screen.getByRole('button', { name: 'Сообщить об ошибке' }))
    const dialog = await screen.findByRole('dialog', { name: 'Сообщить об ошибке' })
    // over the whole window, not inside the sidebar the button lives in
    expect(dialog.parentElement).toBe(document.body)
    expect(container.contains(dialog)).toBe(false)
    expect(await screen.findByText(/можно отправить после входа в аккаунт/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Написать в Telegram' })).toHaveAttribute('href', SUPPORT_TELEGRAM_URL)
    expect(dialog.querySelector('form')).toBeNull()
    expect(serviceRequest).not.toHaveBeenCalled()
  })

  it('«Ваши предложения» under «Сообщить об ошибке»: the same dialog sends an idea with a photo, without the bug reward (owner, 13.10.2026)', async () => {
    const serviceRequest = mockDesktop(signedIn)
    const user = userEvent.setup({ applyAccept: false })
    render(<SupportButtons variant="nav" />)
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Связаться', 'Сообщить об ошибке', 'Ваши предложения'])
    await user.click(screen.getByRole('button', { name: 'Ваши предложения' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ваши предложения' })
    expect(dialog).toHaveTextContent('Есть идея для Raid OS?')
    expect(dialog).not.toHaveTextContent('+1 день')
    await user.type(await screen.findByLabelText('Тема'), 'Таймер рейда')
    expect(screen.getByLabelText('Тема')).toHaveAttribute('placeholder', 'Коротко: ваша идея')
    await user.type(screen.getByLabelText(/Описание/), 'Показывать, сколько осталось до конца рейда')
    await user.upload(screen.getByLabelText('Фото'), new File([PNG_BYTES], 'idea.png', { type: 'image/png' }))
    expect(await screen.findByRole('img', { name: 'idea.png' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать фото idea.png' })).toBeInTheDocument()
    expect(screen.getByText('К предложению автоматически добавятся:')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Отправить предложение' }))
    expect(await screen.findByText('Спасибо! Предложение отправлено')).toBeInTheDocument()
    expect(dialog).not.toHaveTextContent('Если ошибка подтвердится')
    const [method, path, body] = serviceRequest.mock.calls[0] as [string, string, { kind: string; topic: string; description: string; screenshots: Array<{ data: string }> }]
    expect([method, path]).toEqual(['POST', '/v1/bug-reports'])
    expect(body.kind).toBe('idea')
    expect(body.topic).toBe('Таймер рейда')
    expect(body.description).toBe('Показывать, сколько осталось до конца рейда')
    expect(body.screenshots).toHaveLength(1)
    expect(body.screenshots[0]!.data).toMatch(/^data:image\/png;base64,/)
  })

  it('asks to sign in before sending an idea', async () => {
    const serviceRequest = mockDesktop(signedOut)
    const user = userEvent.setup()
    render(<SupportButtons variant="panel" />)
    await user.click(screen.getByRole('button', { name: 'Ваши предложения' }))
    const dialog = await screen.findByRole('dialog', { name: 'Ваши предложения' })
    expect(await screen.findByText(/Предложение можно отправить после входа в аккаунт/)).toBeInTheDocument()
    expect(dialog.querySelector('form')).toBeNull()
    expect(serviceRequest).not.toHaveBeenCalled()
  })

  it('describes the system from the user agent', () => {
    expect(describePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/33')).toBe('Windows 10/11 x64 · browser')
    expect(describePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android 14 · browser')
  })

  it('has English for every new phrase', async () => {
    const { setRenderLanguage, uiText } = await import('../i18n/renderText')
    setRenderLanguage('en')
    try {
      expect(uiText('Связаться')).toBe('Contact us')
      expect(uiText('Перейти в Telegram-канал Raid OS, чтобы написать нам?')).toBe('Open the Raid OS Telegram channel to message us?')
      expect(uiText('Да')).toBe('Yes')
      expect(uiText('Нет')).toBe('No')
      expect(uiText('Сообщить об ошибке')).toBe('Report a bug')
      expect(uiText('Спасибо! Отчёт отправлен')).toBe('Thank you! The report has been sent')
      expect(uiText('Скриншоты принимаются только в PNG, JPEG или WEBP')).toBe('Screenshots are accepted only as PNG, JPEG or WEBP')
      expect(uiText('Ваши предложения')).toBe('Your suggestions')
      expect(uiText('Отправить предложение')).toBe('Send suggestion')
      expect(uiText('Фото')).toBe('Photos')
      expect(uiText('Спасибо! Предложение отправлено')).toBe('Thank you! The suggestion has been sent')
    } finally {
      setRenderLanguage('ru')
    }
  })
})
