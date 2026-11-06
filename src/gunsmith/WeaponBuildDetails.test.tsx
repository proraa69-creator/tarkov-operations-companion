import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WeaponBuildAttribute } from '../domain/types'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { WeaponBuildDetails } from './WeaponBuildDetails'

vi.mock('../data/DataProvider', () => ({ useTarkovData: () => ({ data: { items: [], traders: [], metadata: {} } }) }))
vi.mock('../state/AppState', () => ({ useAppState: () => ({ raidMode: 'pvp' }) }))

const RECOIL: WeaponBuildAttribute = { name: 'recoil', compare: '<=', value: 240 }
// «Оружейник. Vector 9x19»: the owner's screenshot shows 240 in the game, our count of the example build 265.
const VECTOR_PART = '639872fc93ae507d5858c3a6'
const VECTOR = '5fc3f2d5900b1d5091531e57'

function drawn(questId: string | undefined, met: boolean, actual: number) {
  render(<LocaleProvider><WeaponBuildDetails build={{ weaponId: VECTOR, partIds: [], attributes: [RECOIL] }} questId={questId} checks={[{ attribute: RECOIL, actual, met }]} /></LocaleProvider>)
  return document.querySelector('.gs-stats li') as HTMLElement
}

describe('a target against the owner\'s screenshot', () => {
  it('a count that misses gives way to the screenshot: no red cross, check it in the game', () => {
    const row = drawn(VECTOR_PART, false, 265)
    expect(row).toHaveClass('is-unknown')
    expect(row).not.toHaveClass('is-missed')
    expect(row).not.toHaveTextContent('265')
  })

  it('a count that passes stays', () => {
    const row = drawn(VECTOR_PART, true, 231)
    expect(row).toHaveClass('is-met')
    expect(row).toHaveTextContent('231')
  })

  it('without a screenshot a miss is a miss', () => {
    const row = drawn('other-task', false, 265)
    expect(row).toHaveClass('is-missed')
    expect(row).toHaveTextContent('265')
  })
})
