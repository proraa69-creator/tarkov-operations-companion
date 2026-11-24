import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearNotifications, MAX_NOTIFICATIONS } from '../notifications/notificationCenter'
import { TOAST_MS } from '../notifications/ToastDock'
import type { PlayerNotice } from '../shared/notices'
import { NoticeToast } from './NoticeToast'

const taken: PlayerNotice = { id: 1_000_087, kind: 'announcement', title: 'Отчёт №87 принят в работу', text: 'Спасибо!', titleEn: 'Your report №87 is being worked on', textEn: 'Thank you!', images: 0, createdAt: '2026-11-07T10:00:00.000Z' }
const withPhoto: PlayerNotice = { id: 5, kind: 'announcement', title: 'Новый канал', text: 'Подписывайтесь', images: 1, button: { text: 'Telegram', url: 'https://t.me/raidos' }, createdAt: '2026-11-07T10:00:00.000Z' }
const loadImage = vi.fn(async () => 'data:image/png;base64,AA==')

function show(notice: PlayerNotice = taken, locale: 'ru' | 'en' = 'ru') {
  const onClose = vi.fn()
  const onSeen = vi.fn()
  render(<NoticeToast notice={notice} locale={locale} loadImage={loadImage} onSeen={onSeen} onClose={onClose} />)
  return { onClose, onSeen }
}

const stored = () => JSON.parse(localStorage.getItem('raidos-notifications-v1') ?? '[]') as Array<{ title: string; text: string }>

describe('a message in the corner (owner, 07.11.2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    clearNotifications()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('takes seven seconds, over nothing, and closes by itself', () => {
    const { onClose, onSeen } = show()
    expect(TOAST_MS).toBe(7000)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Отчёт №87 принят в работу')
    expect(onSeen).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(TOAST_MS - 1) })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the cross closes it at once; a resting mouse keeps it, and it gets its time again after', () => {
    const { onClose } = show()
    const toast = screen.getByRole('status')
    fireEvent.pointerEnter(toast, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(TOAST_MS * 3) })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('its words stay in «Уведомления», once however often it comes', () => {
    show()
    cleanup()
    show()
    expect(stored()).toEqual([expect.objectContaining({ title: 'Отчёт №87 принят в работу', text: 'Спасибо!' })])
    expect(MAX_NOTIFICATIONS).toBeGreaterThan(1)
  })

  it('the photos and the owner\'s button are in the corner too, and an enlarged photo keeps it', async () => {
    const { onClose } = show(withPhoto)
    expect(screen.getByRole('link', { name: 'Telegram' })).toHaveAttribute('href', 'https://t.me/raidos')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }))
    expect(screen.getByRole('dialog', { name: 'Фото' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(TOAST_MS * 2) })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть фото' }))
    act(() => { vi.advanceTimersByTime(TOAST_MS) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('in English where it was written', () => {
    show(taken, 'en')
    expect(screen.getByRole('status')).toHaveTextContent('Your report №87 is being worked on')
    expect(screen.getByRole('status')).toHaveTextContent('Thank you!')
  })
})
