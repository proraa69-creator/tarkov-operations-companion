import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { HideoutSection, HideoutTabs } from './HideoutTabs'

const tabsAt = (entry: string) => render(<LocaleProvider><MemoryRouter initialEntries={[entry]}><HideoutTabs /></MemoryRouter></LocaleProvider>)
const link = (name: RegExp) => screen.getByRole('link', { name })

describe('«Убежище и квесты»: three buttons at the top', () => {
  it('«Убежище» opens the hideout; pressed again there, its items; the list button beside it opens them at once', () => {
    const { unmount } = tabsAt('/hideout')
    expect(link(/^Убежище$/)).toHaveAttribute('aria-current', 'page')
    expect(link(/^Убежище$/)).toHaveAttribute('href', '/hideout/stash')
    expect(link(/Предметы для убежища/)).toHaveAttribute('href', '/hideout/stash')
    expect(link(/Предметы для убежища/)).not.toHaveAttribute('aria-current')
    expect(link(/Квесты/)).toHaveAttribute('href', '/hideout/quests')
    expect(link(/Круг сектантов/)).toHaveAttribute('href', '/hideout/cultist-circle')
    unmount()
    tabsAt('/hideout/stash')
    expect(link(/^Убежище$/)).toHaveAttribute('href', '/hideout')
    expect(link(/Предметы для убежища/)).toHaveAttribute('aria-current', 'page')
  })

  it('from the quests or the circle «Убежище» goes back to the hideout', () => {
    tabsAt('/hideout/quests')
    expect(link(/Квесты/)).toHaveAttribute('aria-current', 'page')
    expect(link(/^Убежище$/)).toHaveAttribute('href', '/hideout')
    expect(link(/^Убежище$/)).not.toHaveAttribute('aria-current')
  })

  it('the buttons stay put while the page under them changes', () => {
    render(<LocaleProvider><MemoryRouter initialEntries={['/hideout']}><Routes>
      <Route element={<HideoutSection />}>
        <Route path="/hideout" element={<p>вид сверху</p>} />
        <Route path="/hideout/stash" element={<p>предметы</p>} />
        <Route path="/hideout/quests" element={<p>квесты</p>} />
        <Route path="/hideout/cultist-circle" element={<p>круг</p>} />
      </Route>
    </Routes></MemoryRouter></LocaleProvider>)
    const tabs = screen.getByRole('navigation', { name: 'Убежище и квесты' })
    fireEvent.click(link(/^Убежище$/))
    expect(screen.getByText('предметы')).toBeInTheDocument()
    fireEvent.click(link(/^Убежище$/))
    expect(screen.getByText('вид сверху')).toBeInTheDocument()
    fireEvent.click(link(/Круг сектантов/))
    expect(screen.getByText('круг')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Убежище и квесты' })).toBe(tabs)
  })

  it('speaks English', () => {
    localStorage.setItem('tarkov-operations-locale-v1', 'en')
    render(<LocaleProvider><MemoryRouter initialEntries={['/hideout']}><HideoutTabs /></MemoryRouter></LocaleProvider>)
    expect(screen.getByRole('navigation', { name: 'Hideout & quests' })).toBeInTheDocument()
    for (const name of ['Hideout', 'Tasks', 'Cultist Circle', 'Hideout items']) expect(screen.getByRole('link', { name })).toBeInTheDocument()
    localStorage.clear()
  })
})
