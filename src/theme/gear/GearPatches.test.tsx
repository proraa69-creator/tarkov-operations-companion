import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GearPatches } from './GearPatches'

afterEach(cleanup)

describe('the «Снаряжение» sidebar patches (owner, 10.11.2026)', () => {
  it('are the name tape and the blood type only: no faction patch, no round morale patch', () => {
    render(<GearPatches locale="ru" callsign="Raid_OS" faction="usec" />)
    const patches = document.querySelector('.gear-patches')!
    expect([...patches.querySelectorAll('svg.gear-patch')].map((svg) => svg.getAttribute('class'))).toEqual(['gear-patch gear-patch-name', 'gear-patch gear-patch-blood'])
    expect(patches.textContent).toContain('RAID_OS')
    expect(patches.textContent).not.toMatch(/USEC|PMC|НОЧНАЯ СМЕНА/)
  })
})
