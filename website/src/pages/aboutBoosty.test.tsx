import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AboutPage } from './AboutPage'

afterEach(cleanup)

describe('«О нас»', () => {
  it('has «Мы на Boosty» opening the project page on Boosty in a new tab (owner, 21.10.2026)', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>)
    const link = screen.getByRole('link', { name: /Мы на Boosty/ })
    expect(link).toHaveAttribute('href', 'https://boosty.to/raidosapp')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(screen.getByRole('link', { name: /Скачать приложение/ })).toHaveAttribute('href', '/download')
  })
})
