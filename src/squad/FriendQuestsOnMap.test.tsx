import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CRS } from 'leaflet'
import { MapContainer } from 'react-leaflet'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FriendQuestMarkers } from './FriendQuestsOnMap'
import type { FriendQuestPoint } from './friendQuestLayer'

const point = (objectiveId: string, position: [number, number]): FriendQuestPoint => ({
  key: `f:q1:${objectiveId}`, position, color: '#7fd18b', nickname: 'Shturman_77', questId: 'q1', questName: 'Глаз орла', trader: 'Миротворец',
  objectiveId, label: objectiveId, slot: 0,
  left: [{ objectiveId: 'o1', text: 'Найти склад' }, { objectiveId: 'o2', text: 'Осмотреть офис' }],
})

describe('a friend’s point on the map (owner, 08.11.2026: «По нажатию должно открываться окно с квестом»)', () => {
  it('a press opens the window of the friend’s quest: who, which quest, what is left here with this point lit, the quest’s card', async () => {
    render(<MemoryRouter>
      <MapContainer crs={CRS.Simple} center={[0, 0]} zoom={1} zoomControl={false} attributionControl={false} style={{ width: 400, height: 400 }}>
        <FriendQuestMarkers points={[point('o1', [0, 0]), point('o2', [10, 10])]} />
      </MapContainer>
    </MemoryRouter>)
    expect(document.querySelector('.friend-quest-card')).toBeNull()
    fireEvent.click(document.querySelectorAll('.friend-quest-pin')[1])
    await waitFor(() => expect(document.querySelector('.friend-quest-card')).not.toBeNull())
    expect(screen.getByText('Shturman_77')).toBeInTheDocument()
    expect(screen.getByText('Глаз орла')).toBeInTheDocument()
    expect([...document.querySelectorAll('.friend-quest-card-goals li')].map((line) => [line.textContent, line.className])).toEqual([['Найти склад', ''], ['Осмотреть офис', 'is-here']])
    expect(screen.getByRole('link', { name: /Открыть задание/ })).toHaveAttribute('href', '/quests?filter=all&selected=q1')
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(document.querySelector('.friend-quest-card')).toBeNull())
  })
})
