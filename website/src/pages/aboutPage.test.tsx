import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'

afterEach(cleanup)

describe('«О нас»', () => {
  it('leads to the download; the Boosty page is gone (owner, 03.11.2026: «все что связано с бусти удаляй»)', () => {
    const { container } = render(<MemoryRouter><AboutPage /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /Скачать приложение/ })).toHaveAttribute('href', '/download')
    expect(screen.getByRole('link', { name: 'raidosapp@gmail.com' })).toHaveAttribute('href', 'mailto:raidosapp@gmail.com')
    expect(container.querySelector('a[href*="boosty"]')).toBeNull()
    expect(screen.queryByText(/Boosty/)).toBeNull()
  })
})
