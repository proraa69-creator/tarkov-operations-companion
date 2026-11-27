import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The bosses on the raid card are decoration (owner, 27.11.2026: «Боссы просто как декор там… нажимались, но не подсвечивались,
 * не двигались, ничего… нажал, и открылась первая карточка босса, где здоровье, вооружение… и его 3D-модель»).
 */
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))
vi.mock('../overview/overviewDefaultsStore', () => ({ useOverviewDefaults: () => null }))
vi.mock('../data/bossFigures', () => ({
  bossFiguresFor: () => [
    { key: 'killa', url: '/killa.webp', name: { ru: 'Килла', en: 'Killa' }, height: 1 },
    { key: 'no-card', url: '/no-card.webp', name: { ru: 'Без карточки', en: 'No card' }, height: 1 },
  ],
}))

const { BossFigures } = await import('./BossFigures')
const { LocaleProvider } = await import('../i18n/LocaleProvider')

function Gallery() {
  const state = useLocation().state as { boss?: string } | null
  return <p data-testid="gallery">{state?.boss}</p>
}

afterEach(cleanup)

describe('the bosses on the raid card', () => {
  it('open the boss’s card in «Боссы» on a click, with no «Тактика боя» and nothing that lights up', () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/']}><Routes>
      <Route path="/" element={<BossFigures mapId="customs" />} />
      <Route path="/gallery" element={<Gallery />} />
    </Routes></MemoryRouter></LocaleProvider>)
    expect(screen.queryByText('Тактика боя')).toBeNull()
    expect(document.querySelector('.boss-figure-hint')).toBeNull()
    // no window with a name under the pointer either (AppTooltips shows any `title`); the name stays for a screen reader
    expect(document.querySelector('.boss-figures [title]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Килла' })).toBeInTheDocument()
    // a boss without a card in «Боссы» is a picture only
    expect(document.querySelectorAll('.boss-figure-link')).toHaveLength(1)
    fireEvent.click(document.querySelector('.boss-figure-link')!)
    expect(screen.getByTestId('gallery')).toHaveTextContent('killa')
  })
})
