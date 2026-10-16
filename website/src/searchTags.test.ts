import { afterEach, describe, expect, it } from 'vitest'
import { setSiteLocale } from './i18n'
import { updateSearchTags } from './searchTags'

const head = () => ({
  description: document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
  robots: document.head.querySelector('meta[name="robots"]')?.getAttribute('content'),
  canonical: document.head.querySelector('link[rel="canonical"]')?.getAttribute('href'),
  alternates: [...document.head.querySelectorAll('link[rel="alternate"]')].map((link) => `${link.getAttribute('hreflang')} ${link.getAttribute('href')}`),
})

describe('search engine tags', () => {
  afterEach(() => { setSiteLocale('ru', { remember: false }); document.head.innerHTML = '' })

  it('opens the public pages with their own address in each language', () => {
    updateSearchTags('/download', '?lang=ru')
    expect(head()).toEqual({
      description: expect.stringContaining('Escape from Tarkov'),
      robots: 'index, follow',
      canonical: 'https://raidos.app/download?lang=ru',
      alternates: ['ru https://raidos.app/download?lang=ru', 'en https://raidos.app/download?lang=en', 'x-default https://raidos.app/download'],
    })
    updateSearchTags('/', '')
    expect(head().canonical).toBe('https://raidos.app/')
    expect(head().description).toContain('Тарков')
    // The English page describes itself in English.
    setSiteLocale('en', { remember: false })
    updateSearchTags('/', '?lang=en')
    expect(head()).toMatchObject({ canonical: 'https://raidos.app/?lang=en', description: expect.stringContaining('Escape from Tarkov (EFT) companion') })
  })

  it('keeps accounts, invitations and unknown addresses out of search', () => {
    for (const path of ['/cabinet', '/admin', '/login', '/squad/ABC123', '/r/streamer', '/no-such-page']) {
      updateSearchTags(path, '')
      expect(head(), path).toMatchObject({ robots: 'noindex, follow', canonical: undefined, alternates: [] })
    }
  })

  it('indexes the documents in Russian only', () => {
    updateSearchTags('/legal/offer', '?lang=en')
    expect(head()).toMatchObject({ robots: 'index, follow', canonical: 'https://raidos.app/legal/offer', alternates: [] })
  })
})
