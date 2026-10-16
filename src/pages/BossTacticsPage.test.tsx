import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { setRenderLanguage } from '../i18n/renderText'
import { BossTacticsPage } from './BossTacticsPage'

function renderTactics(key: string) {
  return render(<LocaleProvider><MemoryRouter initialEntries={[`/bosses/${key}/tactics`]}><Routes><Route path="/bosses/:key/tactics" element={<BossTacticsPage />} /></Routes></MemoryRouter></LocaleProvider>)
}

afterEach(() => { localStorage.clear(); setRenderLanguage('ru') })

describe('BossTacticsPage', () => {
  it('shows the tactics in Russian by default', () => {
    renderTactics('glukhar')
    expect(screen.getByText('Слабые места')).toBeInTheDocument()
    expect(screen.getByText(/Босс Резерва со свитой/)).toBeInTheDocument()
  })

  it('is English in the English interface: headings and every line (owner, 13.10.2026)', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    const { container } = renderTactics('glukhar')
    expect(screen.getByText('Weak spots')).toBeInTheDocument()
    expect(screen.getByText('Battle plan')).toBeInTheDocument()
    expect(screen.getByText(/The Reserve boss with up to six guards/)).toBeInTheDocument()
    expect(container.querySelector('.boss-tactics-grid')?.textContent ?? '').not.toMatch(/[А-Яа-яЁё]/)
  })
})
