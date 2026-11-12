import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'

vi.mock('../platform', async (original) => ({ ...await original<typeof import('../platform')>(), useMobileLayout: () => true }))
const { GoonCard } = await import('./GoonCard')

// Owner, 13.11.2026: on the phone «при нажатии на окно кочевники… кнопки зависают и не нажимаются, крестик тоже не
// работает, помогает только выкл вкл приложения» — the portal sheet's taps bubbled to the card and opened it again.
describe('«Кочевники» sheet on the phone', () => {
  beforeEach(() => { localStorage.clear(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  const open = () => {
    const { container } = render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => id} /></LocaleProvider>)
    fireEvent.click(container.querySelector('.goon-card')!)
    return screen.getByRole('dialog', { name: 'Кочевники' })
  }

  it('«Закрыть» closes it', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog', { name: 'Кочевники' })).toBeNull()
  })

  it('a tap on the backdrop closes it; a tap inside keeps it', () => {
    const sheet = open()
    fireEvent.click(sheet)
    expect(screen.getByRole('dialog', { name: 'Кочевники' })).toBeInTheDocument()
    fireEvent.click(sheet.parentElement!)
    expect(screen.queryByRole('dialog', { name: 'Кочевники' })).toBeNull()
  })

  it('«Видел» on the card opens the map choice, not the sheet', () => {
    render(<LocaleProvider><GoonCard mode="pvp" mapName={(id) => id} /></LocaleProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Видел' }))
    expect(screen.getByRole('dialog', { name: 'Где видели Кочевников?' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Кочевники' })).toBeNull()
  })
})
