import { act, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopBackButton, noteSidebarNavigation, resetBackOrigin, useDesktopBackOrigin } from './desktopBack'

function Shell() {
  useDesktopBackOrigin(true)
  return <>
    <nav onClickCapture={noteSidebarNavigation}><Link to="/flea">Барахолка</Link></nav>
    <DesktopBackButton />
    <Routes>
      <Route path="/quests" element={<div><Link to="/quests?quest=stilyagi">Стиляги</Link><Link to="/maps/customs">Показать на карте</Link></div>} />
      <Route path="/maps/:id" element={<div>карта</div>} />
      <Route path="/flea" element={<div>барахолка</div>} />
    </Routes>
  </>
}

describe('«Назад» on the PC (owner, 20.10.2026)', () => {
  afterEach(() => { resetBackOrigin(); window.history.replaceState(null, '', '/') })

  it('appears after going into something from the content and returns there once; the sidebar never adds it', async () => {
    window.history.replaceState({ idx: 0, key: 'start', usr: null }, '', '/quests')
    render(<BrowserRouter><Shell /></BrowserRouter>)
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()
    // A change within the page (a quest opened) is no «go into».
    fireEvent.click(screen.getByText('Стиляги'))
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()
    fireEvent.click(screen.getByText('Показать на карте'))
    expect(screen.getByText('карта')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Назад' })) })
    await screen.findByText('Стиляги')
    expect(window.location.search).toBe('?quest=stilyagi')
    // Back at the list: no further «Назад» (not a chain through every page).
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()
    // Through the sidebar: no «Назад».
    fireEvent.click(screen.getByText('Барахолка'))
    expect(screen.getByText('барахолка')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Назад' })).toBeNull()
  })
})
