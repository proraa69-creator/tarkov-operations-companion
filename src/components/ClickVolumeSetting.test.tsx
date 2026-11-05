import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sound = vi.hoisted(() => ({ volume: 1, play: vi.fn(), set: vi.fn() }))
vi.mock('../shared/uiSound', () => ({
  uiSoundVolume: () => sound.volume,
  setUiSoundVolume: (value: number) => { sound.volume = value; sound.set(value) },
  playUiSound: sound.play,
}))
const { ClickVolumeSetting } = await import('./ClickVolumeSetting')

afterEach(() => { sound.volume = 1; sound.play.mockClear(); sound.set.mockClear() })

// Owner, 03.11.2026: «сделай ползунок громкости, если минимальный, это выкл щелчки».
describe('Settings → «Громкость щелчков»', () => {
  it('a slider from off to 100 %, the click plays at the new level when let go', () => {
    render(<ClickVolumeSetting />)
    const slider = screen.getByRole('slider', { name: 'Громкость щелчков' })
    expect(slider).toHaveValue('100')
    expect(screen.getByText('100%')).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '35' } })
    expect(sound.set).toHaveBeenLastCalledWith(0.35)
    expect(screen.getByText('35%')).toBeInTheDocument()
    fireEvent.pointerUp(slider)
    expect(sound.play).toHaveBeenCalledWith('click')
    fireEvent.change(slider, { target: { value: '0' } })
    expect(sound.set).toHaveBeenLastCalledWith(0)
    expect(screen.getByText('Щелчки выключены')).toBeInTheDocument()
  })
})
