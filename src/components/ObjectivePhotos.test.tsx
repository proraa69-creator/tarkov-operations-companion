import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestSheetObjectives } from './QuestSheetObjectives'
import { QuestGuidePhotos } from './QuestGuidePhotos'
import type { SheetObjectives } from '../progression/sheetObjectives'

/**
 * Owner, 04.11.2026, «Что-то мне это напоминает…»: «при наведении курсора мыши на какую-либо из точек появлялись всплывающее
 * окно с фотографиями … нажать, и она увеличится. Повторное нажатие выключает фотографию … их можно листать … можно
 * перенести мышку дальше на следующую цель … у каждого места должны быть свои фотографии».
 */
vi.mock('../data/questGuidePhotos.json', () => ({
  default: {
    quests: {
      q1: {
        wiki: 'https://wiki.example/Q1',
        photos: [
          { id: 'p1', caption: 'Общий вид' },
          { id: 'p2', caption: 'Ворота', objectiveId: 'game-1' },
          { id: 'p3', caption: 'Палата', objectiveId: 'game-2' },
          { id: 'p4', caption: 'Коридор', objectiveId: 'game-2' },
          { id: 'p5', caption: 'Вход в дом', objectiveId: 'game-1', alsoFor: ['game-2'] },
        ],
      },
    },
    files: Object.fromEntries(['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => [id, { file: `${id}.png`, url: `https://img.example/${id}.png` }])),
  },
}))
vi.mock('../data/eventGuidePhotos.json', () => ({ default: { quests: {}, files: {} } }))

// As the catalog has them: the id is the objective's text, the game's id rides beside it.
const line = (id: string, gameId: string) => ({ id, gameId, text: id, where: null, here: true, done: false })
const sheet: SheetObjectives = {
  showWhere: false,
  groups: [{ kind: 'place', title: 'Заложить', objectives: [line('Цель у ворот', 'game-1'), line('Цель в палате', 'game-2'), line('Цель без фото', 'game-3')] }],
} as unknown as SheetObjectives

const row = (text: string) => screen.getByText(text).closest('li')!
const shownCaptions = () => within(screen.getByTestId('objective-photo-popup')).getAllByRole('listitem').map((item) => item.getAttribute('title'))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const viewerImage = () => within(screen.getByRole('dialog')).getByRole('img')
const ready = async () => { await screen.findAllByTestId('sheet-objective-photos') }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the photos of each place in the map\'s quest window', () => {
  it('a line shows its own photos only, and a line without any shows none', async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель у ворот'))
    expect(shownCaptions()).toEqual(['Ворота', 'Вход в дом'])
    fireEvent.mouseLeave(row('Цель у ворот'))
    fireEvent.mouseEnter(row('Цель в палате'))
    await waitFor(() => expect(shownCaptions()).toEqual(['Палата', 'Коридор', 'Вход в дом']))
    expect(within(row('Цель без фото')).queryByTestId('sheet-objective-photos')).toBeNull()
    fireEvent.mouseLeave(row('Цель в палате'))
    fireEvent.mouseEnter(row('Цель без фото'))
    await waitFor(() => expect(screen.queryByTestId('objective-photo-popup')).toBeNull())
  })

  it('the way up to a photo crosses other lines without changing the photos', async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель в палате'))
    fireEvent.mouseLeave(row('Цель в палате'))
    fireEvent.mouseEnter(row('Цель у ворот'))
    fireEvent.mouseLeave(row('Цель у ворот'))
    fireEvent.mouseEnter(screen.getByTestId('objective-photo-popup'))
    await wait(450)
    expect(shownCaptions()).toEqual(['Палата', 'Коридор', 'Вход в дом'])
  })

  it('stays when the mouse moves on to it and goes when it leaves', async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель у ворот'))
    fireEvent.mouseLeave(row('Цель у ворот'))
    fireEvent.mouseEnter(screen.getByTestId('objective-photo-popup'))
    await wait(450)
    expect(screen.getByTestId('objective-photo-popup')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('objective-photo-popup'))
    await waitFor(() => expect(screen.queryByTestId('objective-photo-popup')).toBeNull())
  })

  it('a click enlarges a photo, the arrows go through this place\'s photos, a click on it closes it and the next line works', async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель в палате'))
    fireEvent.click(within(screen.getByTestId('objective-photo-popup')).getByRole('listitem', { name: 'Коридор' }))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p4.png')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Следующее изображение' }))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p5.png')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Следующее изображение' }))
    // Round to this place's first photo: never another place's.
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p3.png')
    // Leaving the line under the open photo closes nothing.
    fireEvent.mouseLeave(row('Цель в палате'))
    await wait(450)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(viewerImage())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('objective-photo-popup')).toBeInTheDocument()
    fireEvent.mouseEnter(row('Цель у ворот'))
    await waitFor(() => expect(shownCaptions()).toEqual(['Ворота', 'Вход в дом']))
  })

  it('a finger has no hover: the line\'s camera opens the photos', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель у ворот'))
    expect(screen.queryByTestId('objective-photo-popup')).toBeNull()
    fireEvent.click(within(row('Цель у ворот')).getByTestId('sheet-objective-photos'))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p2.png')
  })

  it('without a quest (or one with no photos) the lines stay as they were', async () => {
    render(<QuestSheetObjectives sheet={sheet} trader="Скупщик" />)
    await wait(50)
    expect(screen.queryByTestId('sheet-objective-photos')).toBeNull()
  })

  it('the quest card groups them by the game\'s id too: a photo under each of its places, the rest under the whole quest', async () => {
    const details = [{ id: 'Цель у ворот', gameId: 'game-1', description: 'Цель у ворот' }, { id: 'Цель в палате', gameId: 'game-2', description: 'Цель в палате' }]
    render(<QuestGuidePhotos quest={{ id: 'q1', objectiveDetails: details }} />)
    const gates = (await screen.findByText('Цель у ворот')).parentElement!
    expect(within(gates).getAllByRole('listitem').map((item) => item.getAttribute('title'))).toEqual(['Ворота', 'Вход в дом'])
    const ward = screen.getByText('Цель в палате').parentElement!
    expect(within(ward).getAllByRole('listitem').map((item) => item.getAttribute('title'))).toEqual(['Палата', 'Коридор', 'Вход в дом'])
    const whole = screen.getByText('Весь квест').parentElement!
    expect(within(whole).getAllByRole('listitem').map((item) => item.getAttribute('title'))).toEqual(['Общий вид'])
    expect(screen.getByText(/· 5/)).toBeInTheDocument()
  })
})
