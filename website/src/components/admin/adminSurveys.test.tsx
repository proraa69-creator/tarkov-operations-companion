import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** «Опросы»: the statistics with the respondents' e-mails, filters, CSV and «Написать» (owner, 15.10.2026). */
vi.mock('../../auth', () => ({ useAuth: () => ({ status: 'ready', token: 'owner-token', account: { email: 'owner@example.com', owner: true } }) }))
const { AdminSurveys } = await import('./AdminSurveys')

const questions = [
  { id: 'q1', text: 'Где играете?', type: 'single', options: [{ id: 'o1', text: 'PvP' }, { id: 'o2', text: 'PvE' }], required: true },
  { id: 'q2', text: 'Что добавить?', type: 'text', required: false },
]
const survey = { id: 3, kind: 'survey', title: 'Как вам Raid OS?', text: '', images: 0, questions, audience: { regions: [], payment: 'all' }, createdAt: '2026-10-15T10:00:00.000Z', targeted: 10, seen: 6, closed: 2, responses: 2 }
const results = {
  survey,
  questions: [
    { id: 'q1', type: 'single', text: 'Где играете?', answered: 2, options: [{ id: 'o1', text: 'PvP', count: 1, percent: 50 }, { id: 'o2', text: 'PvE', count: 1, percent: 50 }] },
    { id: 'q2', type: 'text', text: 'Что добавить?', answered: 1, answers: [{ text: 'Миникарту', email: 'moscow@example.com', createdAt: '2026-10-15T11:00:00.000Z' }] },
  ],
  responses: [
    { accountId: 'a'.repeat(24), email: 'berlin@example.com', country: 'DE', region: 'europe', createdAt: '2026-10-15T12:00:00.000Z', answers: { q1: ['o2'] } },
    { accountId: 'b'.repeat(24), email: 'moscow@example.com', country: 'RU', region: 'cis', createdAt: '2026-10-15T11:00:00.000Z', answers: { q1: ['o1'], q2: 'Миникарту' } },
  ],
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('admin «Опросы»', () => {
  it('shows counts and shares, the free answers, the respondents\' e-mails; filters by region; exports CSV', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/accounts/me/admin/notices?kind=survey')) return Response.json({ notices: [survey] })
      if (url.endsWith('/v1/accounts/me/admin/surveys/3/results')) return Response.json(results)
      if (url.endsWith('/v1/accounts/me/admin/surveys/3/responses.csv')) return new Response('﻿Дата;E-mail\r\n', { headers: { 'content-type': 'text/csv' } })
      return Response.json({ error: 'Не найдено' }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const createObjectURL = vi.fn(() => 'blob:csv')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/admin?tab=surveys']}><AdminSurveys /></MemoryRouter>)
    expect(await screen.findByRole('tab', { name: /Как вам Raid OS\?/ })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findAllByText('1 · 50 %', { exact: false })).toHaveLength(2)
    expect(screen.getByText('Миникарту', { selector: '.admin-survey-texts span' })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('berlin@example.com')).toBeInTheDocument()
    expect(within(table).getAllByRole('button', { name: 'Написать' })).toHaveLength(2)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Регион' }), 'cis')
    expect(within(table).queryByText('berlin@example.com')).not.toBeInTheDocument()
    expect(within(table).getByText('moscow@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Выгрузить CSV' }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/responses\.csv$/), expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer owner-token' }) }))
  })
})
