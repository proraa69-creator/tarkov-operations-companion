import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PositionSetupCard } from './PositionSetupCard'
import type { ExperimentalStatus } from './types'

const status = (patch: Partial<ExperimentalStatus> = {}): ExperimentalStatus => ({
  hookReady: true, hookError: '', tracking: true, screenshotsFolder: 'C:\\Users\\p\\Documents\\Escape from Tarkov\\Screenshots', screenshotCandidates: [],
  lastScreenshot: null, screenshotKey: { keys: ['Print'], label: 'PrtSc', source: 'default', unbound: false }, otherKeys: [], elevated: true, nativeError: '',
  gameSeenAt: null, gameKeys: 'unknown', lastPosition: null, raid: { inRaid: false }, displayMode: 'unknown',
  remoteMinimap: true, trackingOn: true, positionSentAt: null,
  watchedFolders: [
    { folder: 'C:\\Users\\p\\Documents\\Escape from Tarkov\\Screenshots', exists: true, watching: true },
    { folder: 'C:\\Users\\p\\OneDrive\\Documents\\Escape from Tarkov\\Screenshots', exists: false, watching: false },
  ],
  ...patch,
})

describe('«Проверка точки на карте» in the settings: the chain as this PC sees it', () => {
  it('shows the switch as the main process has it, the folders, the last file and what its name gave', () => {
    render(<PositionSetupCard status={status({
      lastScreenshot: { name: '2026-10-16[18-00]_-230.88, 3.59, -375.83_0, 0, 0, 1_0.64 (0).png', withCoordinates: true, at: Date.now(), folder: 'C:\\Users\\p\\Documents\\Escape from Tarkov\\Screenshots', position: { x: -230.88, y: 3.59, z: -375.83 }, stale: false },
      positionSentAt: Date.now(),
      raid: { inRaid: true, location: 'laboratory' },
    })} />)
    expect(screen.getByText('Проверка точки на карте')).toBeInTheDocument()
    expect(screen.getByText('включено')).toBeInTheDocument()
    expect(screen.getByText('работает')).toBeInTheDocument()
    expect(screen.getByText(/есть, слежу/)).toBeInTheDocument()
    expect(screen.getByText(/папки нет/)).toBeInTheDocument()
    expect(screen.getByText(/x -230\.9, z -375\.8/)).toBeInTheDocument()
    expect(screen.getByText(/Лаборатория/)).toBeInTheDocument()
  })

  it('says what stops the dot: the switch off in this app, a name without coordinates, no file yet', () => {
    const { rerender } = render(<PositionSetupCard status={status({ remoteMinimap: false, tracking: false })} />)
    expect(screen.getByText('выключено')).toBeInTheDocument()
    expect(screen.getByText('не работает')).toBeInTheDocument()
    expect(screen.getByText(/с запуска слежения не было/)).toBeInTheDocument()
    rerender(<PositionSetupCard status={status({ lastScreenshot: { name: '2026-10-16[18-00]_7.92 (0).png', withCoordinates: false, at: Date.now(), position: null } })} />)
    expect(screen.getByText(/в имени нет координат/)).toBeInTheDocument()
  })

  it('not on «Обзор» (compact) while nothing stops the dot', () => {
    const { container } = render(<PositionSetupCard status={status()} compact />)
    expect(container).toBeEmptyDOMElement()
  })
})
