import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestGuidePhotoStrip } from './QuestGuidePhotos'

/**
 * «Фото мест» in the map's quest window (owner, 02.11.2026: «если задание с "картинкой", можно добавить ее как раз таки в
 * пустое место в окне снизу»): three thumbnails, the clicked point's objective first, «+N» for the rest, full size on a click.
 */
vi.mock('../data/questGuidePhotos.json', () => ({
  default: {
    quests: {
      q1: {
        wiki: 'https://wiki.example/Q1',
        photos: [
          { id: 'p1', caption: 'Общий вид' },
          { id: 'p2', caption: 'Ящик у ворот', objectiveId: 'o1' },
          { id: 'p3', caption: 'Второй этаж', objectiveId: 'o2' },
          { id: 'p4', caption: 'Крыша' },
          { id: 'p5', caption: 'Подвал', objectiveId: 'o2' },
        ],
      },
    },
    files: Object.fromEntries(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => [id, { file: `${id}.png`, url: `https://img.example/${id}.png` }])),
  },
}))
vi.mock('../data/eventGuidePhotos.json', () => ({ default: { quests: {}, files: {} } }))

const thumbnails = () => screen.getAllByRole('listitem').map((item) => item.getAttribute('title'))

afterEach(cleanup)

describe('QuestGuidePhotoStrip', () => {
  it('shows the first three photos and «+N» for the rest', async () => {
    render(<QuestGuidePhotoStrip questId="q1" />)
    expect(await screen.findByText(/Фото мест/)).toBeInTheDocument()
    expect(thumbnails()).toEqual(['Общий вид', 'Ящик у ворот', 'Второй этаж'])
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('puts the photos of the clicked point\'s objective first', async () => {
    render(<QuestGuidePhotoStrip questId="q1" focusObjectiveId="o2" />)
    await screen.findByText(/Фото мест/)
    expect(thumbnails()).toEqual(['Второй этаж', 'Подвал', 'Общий вид'])
  })

  it('opens every photo full size from the one clicked', async () => {
    render(<QuestGuidePhotoStrip questId="q1" focusObjectiveId="o2" />)
    await screen.findByText(/Фото мест/)
    fireEvent.click(screen.getByRole('listitem', { name: 'Подвал' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Изображение 2 из 5')
  })

  it('takes every photo from our server, in a plain browser too (03.11.2026: «браться теперь от туда»)', async () => {
    render(<QuestGuidePhotoStrip questId="q1" />)
    await screen.findByText(/Фото мест/)
    expect(screen.getAllByRole('listitem').map((item) => item.querySelector('img')?.getAttribute('src'))).toEqual([
      'https://raidos.app/v1/guide-images/wiki-p1-t.png?v=2', 'https://raidos.app/v1/guide-images/wiki-p2-t.png?v=2', 'https://raidos.app/v1/guide-images/wiki-p3-t.png?v=2',
    ])
    fireEvent.click(screen.getByRole('listitem', { name: 'Ящик у ворот' }))
    expect(screen.getByRole('dialog').querySelector('img')?.getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p2.png?v=2')
    expect(document.body.innerHTML).not.toContain('img.example')
  })

  it('shows nothing for a quest without photos', async () => {
    const { container } = render(<QuestGuidePhotoStrip questId="q2" />)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(container).toBeEmptyDOMElement()
  })
})
