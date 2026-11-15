import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QuestSheetObjectives } from './QuestSheetObjectives'
import { MarkerPlacePhoto, QuestGuidePhotos } from './QuestGuidePhotos'
import type { SheetObjectives } from '../progression/sheetObjectives'

/**
 * Owner, 04.11.2026, «Что-то мне это напоминает…»: «при наведении курсора мыши на какую-либо из точек появлялись всплывающее
 * окно с фотографиями … нажать, и она увеличится. Повторное нажатие выключает фотографию … их можно листать … можно
 * перенести мышку дальше на следующую цель … у каждого места должны быть свои фотографии». Report 167 (15.11.2026): the
 * photo is over the point on the map now, small, and the line shows it no longer on hover.
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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const viewerImage = () => within(screen.getByRole('dialog')).getByRole('img')
const ready = async () => { await screen.findAllByTestId('sheet-objective-photos') }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("the photos of each place in the map's quest window", () => {
  it('a line shows no photo on hover: the photo is over the point on the map (report 167)', async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.mouseEnter(row('Цель у ворот'))
    await wait(50)
    expect(document.querySelector('.objective-photo-popup')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(row('Цель без фото')).queryByTestId('sheet-objective-photos')).toBeNull()
  })

  it("the line's camera enlarges its own photos, the arrows go through them only, a click closes them", async () => {
    render(<QuestSheetObjectives questId="q1" sheet={sheet} trader="Скупщик" />)
    await ready()
    fireEvent.click(within(row('Цель в палате')).getByTestId('sheet-objective-photos'))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p3.png?v=2')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Следующее изображение' }))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p4.png?v=2')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Следующее изображение' }))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p5.png?v=2')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Следующее изображение' }))
    // Round to this place's first photo: never another place's.
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p3.png?v=2')
    fireEvent.click(viewerImage())
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(row('Цель у ворот')).getByTestId('sheet-objective-photos'))
    expect(viewerImage().getAttribute('src')).toBe('https://raidos.app/v1/guide-images/wiki-p2.png?v=2')
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

describe("the place's photo in its point's card on the map (report 167)", () => {
  it("the place's first photo, small, with how many more there are", async () => {
    render(<MarkerPlacePhoto questId="q1" objectiveId="game-2" onOpen={() => {}} />)
    const photo = await screen.findByTestId('marker-place-photo')
    expect(within(photo).getByRole('img').getAttribute('alt')).toBe('Палата')
    expect(within(photo).getByRole('img').className).toBe('mmt-shot')
    expect(photo).toHaveTextContent('+2')
  })

  it("a click opens only this place's photos full size, «+N» the next one, and the map under the card gets no click", async () => {
    const onOpen = vi.fn()
    const mapClick = vi.fn()
    render(<div onClick={mapClick}><MarkerPlacePhoto questId="q1" objectiveId="game-2" onOpen={onOpen} /></div>)
    const photo = await screen.findByTestId('marker-place-photo')
    const own = ['p3', 'p4', 'p5'].map((id) => `https://raidos.app/v1/guide-images/wiki-${id}.png?v=2`)
    fireEvent.click(within(photo).getByRole('img'))
    expect(onOpen).toHaveBeenLastCalledWith(own, 0)
    fireEvent.click(within(photo).getByText('+2'))
    expect(onOpen).toHaveBeenLastCalledWith(own, 1)
    expect(mapClick).not.toHaveBeenCalled()
  })

  it('two photos: «+1»; a place without photos, or a quest without any, shows nothing', async () => {
    const { unmount } = render(<MarkerPlacePhoto questId="q1" objectiveId="game-1" onOpen={() => {}} />)
    expect((await screen.findByTestId('marker-place-photo')).textContent).toBe('+1')
    unmount()
    render(<><MarkerPlacePhoto questId="q1" objectiveId="game-3" onOpen={() => {}} /><MarkerPlacePhoto questId="q9" objectiveId="game-1" onOpen={() => {}} /></>)
    await wait(50)
    expect(screen.queryByTestId('marker-place-photo')).toBeNull()
  })
})
