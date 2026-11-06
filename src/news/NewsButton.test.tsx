import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { NewsButton } from './NewsButton'
import { markAllNewsRead, NEWS, readNews, rememberFirstLook, unreadNews, type NewsEntry } from './newsState'

const entries = (...versions: string[]): NewsEntry[] => versions.map((version) => ({ version, date: '2026-11-05', items: [{ kind: 'added', ru: 'Новое', en: 'New' }] }))

describe('what has been read', () => {
  beforeEach(() => localStorage.clear())

  it('asked twice, it gives the same answer object, even before the first look is kept', () => {
    const list = entries('2', '1')
    expect(readNews(list)).toBe(readNews(list))
  })

  it('the first look counts only the newest entry as unread', () => {
    const list = entries('3', '2', '1')
    expect(unreadNews(readNews(list), list).map((entry) => entry.version)).toEqual(['3'])
  })

  it('an entry left unread stays unread when the next version comes, and all leave once the window is opened', () => {
    rememberFirstLook(entries('2', '1'))
    const next = entries('3', '2', '1')
    expect(unreadNews(readNews(next), next).map((entry) => entry.version)).toEqual(['3', '2'])
    markAllNewsRead(next)
    expect(unreadNews(readNews(next), next)).toEqual([])
  })

  it('a damaged value reads as the first look', () => {
    localStorage.setItem('raidos-news-read-v1', '{oops')
    const list = entries('2', '1')
    expect(unreadNews(readNews(list), list).map((entry) => entry.version)).toEqual(['2'])
  })
})

describe('the button on top', () => {
  beforeEach(() => localStorage.clear())
  const newest = NEWS[0]!

  it('shows the red count; opening the window lists every update and reads them, with no button, and it stays read (owner, 06.11.2026)', () => {
    const { container, unmount } = render(<LocaleProvider><NewsButton /></LocaleProvider>)
    expect(container.querySelector('.nav-badge')).toHaveTextContent('1')
    fireEvent.click(screen.getByRole('button', { name: 'Новости обновлений: 1' }))
    const dialog = screen.getByRole('dialog', { name: 'Новости обновлений' })
    expect(dialog.querySelectorAll('.news-entry')).toHaveLength(NEWS.length)
    const first = dialog.querySelector('.news-entry') as HTMLElement
    expect(first).toHaveTextContent(newest.version)
    expect(first).toHaveClass('is-new')
    expect(within(first).getByText({ added: 'Добавили', changed: 'Изменили', improved: 'Улучшили' }[newest.items[0]!.kind])).toBeInTheDocument()
    expect(dialog.querySelectorAll('.news-entry.is-new')).toHaveLength(1)
    expect(within(dialog).queryByRole('button', { name: /Прочитан|Прочитать/ })).toBeNull()
    expect(dialog).not.toHaveTextContent('рочитано')
    expect(container.querySelector('.nav-badge')).toBeNull()
    unmount()
    const again = render(<LocaleProvider><NewsButton /></LocaleProvider>)
    expect(again.container.querySelector('.nav-badge')).toBeNull()
  })
})

describe('the list itself', () => {
  it('is short, in both languages, the newest first, of versions that exist', () => {
    const versions = new Set((JSON.parse(readFileSync('src/data/updateHistory.json', 'utf8')) as Array<{ version: string }>).map((row) => row.version))
    const number = (version: string) => Number(version.split('.').at(-1))
    NEWS.forEach((entry, index) => {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(entry.items.length).toBeGreaterThan(0)
      if (index) expect(number(entry.version)).toBeLessThan(number(NEWS[index - 1]!.version))
      for (const item of entry.items) {
        expect(['added', 'changed', 'improved']).toContain(item.kind)
        expect(item.ru.length, item.ru).toBeLessThanOrEqual(120)
        expect(item.en.length, item.en).toBeLessThanOrEqual(120)
        expect(item.ru).toMatch(/[а-яё]/i)
        expect(item.en).not.toMatch(/[а-яё]/i)
        // Owner, 06.11.2026: «не пиши, что мы у них берем данные. Про это вообще никогда ничего не пиши».
        expect(`${item.ru} ${item.en}`).not.toMatch(/tarkov[\s-]*market|tarkov\.dev|маркет|источник|\bsources?\b|сотруднич|partner/i)
      }
    })
    const current = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version.replace('-', '.')
    expect(number(NEWS[0]!.version)).toBeLessThanOrEqual(number(current) + 1)
    expect(NEWS.slice(1).every((entry) => versions.has(entry.version))).toBe(true)
  })
})
