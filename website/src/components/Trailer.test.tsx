import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SITE_LOCALES, setSiteLocale } from '../i18n'
import { Trailer } from './Trailer'

/** The home page trailer: the Russian video on the Russian site, the English one on the English site (27.10.2026). */
const MEDIA = join(__dirname, '..', '..', 'public', 'media')
const source = (container: HTMLElement) => container.querySelector('video source')?.getAttribute('src')

describe('Trailer', () => {
  // jsdom has no media playback
  beforeEach(() => { vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined) })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); setSiteLocale('ru', { remember: false }) })

  it('plays the video in the site language and switches with it', () => {
    setSiteLocale('ru', { remember: false })
    const { container } = render(<Trailer />)
    expect(source(container)).toBe('/media/trailer.mp4')
    act(() => setSiteLocale('en', { remember: false }))
    expect(source(container)).toBe('/media/trailer-en.mp4')
  })

  it('has a trailer and a title card of its own in every site language (25.11.2026)', async () => {
    const { container } = render(<Trailer />)
    for (const { code } of SITE_LOCALES.filter((option) => option.code !== 'ru' && (option.code as string) !== 'uk')) {
      // the other languages' phrase files load first: the site switches once they are in
      act(() => setSiteLocale(code, { remember: false }))
      await vi.waitFor(() => expect(source(container)).toBe(`/media/trailer-${code}.mp4`))
      expect(existsSync(join(MEDIA, `trailer-${code}.mp4`))).toBe(true)
      expect(existsSync(join(MEDIA, `trailer-poster-${code}.jpg`))).toBe(true)
    }
  })

  it('shows the Russian trailer on the Ukrainian site (25.11.2026)', async () => {
    if (!SITE_LOCALES.some((option) => (option.code as string) === 'uk')) return
    const { container } = render(<Trailer />)
    act(() => setSiteLocale('en', { remember: false }))
    expect(source(container)).toBe('/media/trailer-en.mp4')
    act(() => setSiteLocale('uk' as Parameters<typeof setSiteLocale>[0], { remember: false }))
    await vi.waitFor(() => expect(source(container)).toBe('/media/trailer.mp4'))
  })
})
