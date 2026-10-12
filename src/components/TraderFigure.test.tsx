import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../theme/gear/useGearActive', () => ({ useReducedMotion: () => true }))
const viewer = vi.hoisted(() => ({ load: vi.fn(), dispose: vi.fn(), resetView: vi.fn(), setSpin: vi.fn() }))
vi.mock('../gallery/bossViewer3d', () => ({ mountBossViewer: () => viewer }))

const { TraderFigure } = await import('./TraderFigure')

afterEach(() => { cleanup(); viewer.load.mockReset() })

describe('Traders page figure', () => {
  it('loads the selected trader\'s 3D model, fitted, with his coat hints', async () => {
    render(<TraderFigure trader={{ id: 'p', name: 'Миротворец', normalizedName: 'peacekeeper', role: '', loyalty: 1, accent: '#888' }} />)
    expect(screen.getByText('Миротворец')).toBeInTheDocument()
    await vi.waitFor(() => expect(viewer.load).toHaveBeenCalled())
    const [url, fix, hints] = viewer.load.mock.calls[0]!
    expect(url).toMatch(/peacekeeper.*\.glb/)
    expect(fix).toEqual({ fit: true })
    expect(hints.cloth.length).toBeGreaterThan(0)
  })

  it('shows the portrait of a trader without a model', () => {
    render(<TraderFigure trader={{ id: 't', name: 'Таран', normalizedName: 'taran', role: '', loyalty: 1, accent: '#888' }} />)
    expect(screen.getByText('3D модель этого торговца скоро появится.')).toBeInTheDocument()
    expect(viewer.load).not.toHaveBeenCalled()
  })
})
