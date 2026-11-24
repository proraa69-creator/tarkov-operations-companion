import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppPrivacyPage } from './LegalPage'
import { legalDocument } from '../legal/documents'

afterEach(cleanup)

// Owner, 13.11.2026: the privacy policy the iPhone app opens «открывается оплата, подписка… Там есть кнопки такие».
describe('/app/privacy', () => {
  it('is the privacy policy alone: no menu, no buttons, no links', () => {
    const { container } = render(<MemoryRouter><AppPrivacyPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: legalDocument('privacy')!.title })).toBeInTheDocument()
    expect(container.querySelectorAll('a, button, nav')).toHaveLength(0)
    expect(screen.queryByText(/Тарифы, оплата и возврат|Личный кабинет/)).toBeNull()
  })
})
