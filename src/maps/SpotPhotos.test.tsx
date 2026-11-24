import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { EXTRA_KEY_SPOTS } from '../data/extraKeySpots'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { SpotPhotos } from './SpotPhotos'

afterEach(cleanup)

describe('photos of a key spot players found (report of 10.11.2026)', () => {
  it('shows every listed photo from the app\'s own pictures, and nothing for a file it has not', () => {
    for (const spot of EXTRA_KEY_SPOTS) {
      const { container, unmount } = render(<LocaleProvider><SpotPhotos photos={spot.photos} /></LocaleProvider>)
      expect(container.querySelectorAll('img')).toHaveLength(spot.photos.length)
      unmount()
    }
    render(<LocaleProvider><SpotPhotos photos={[{ file: 'missing.webp', ru: 'Нет', en: 'None' }]} /></LocaleProvider>)
    expect(screen.queryByRole('list')).toBeNull()
  })
})
