import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setSiteLocale } from '../i18n'
import { Trailer } from './Trailer'

/** The home page trailer: the Russian video on the Russian site, the English one on the English site (27.10.2026). */
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
})
