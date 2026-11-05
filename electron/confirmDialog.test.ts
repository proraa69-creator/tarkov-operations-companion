import { describe, expect, it } from 'vitest'
import { confirmDialogOptions } from './confirmDialog'

describe('a page\'s confirm() as a main-process dialog', () => {
  it('asks with «ОК» first (Enter) and «Отмена» for Esc, in the app\'s language', () => {
    expect(confirmDialogOptions('Начислить 7 дн. подписки отправителю?', 'ru')).toMatchObject({
      title: 'Raid OS', message: 'Начислить 7 дн. подписки отправителю?', buttons: ['ОК', 'Отмена'], defaultId: 0, cancelId: 1, noLink: true,
    })
    expect(confirmDialogOptions('Remove the build?', 'en').buttons).toEqual(['OK', 'Cancel'])
    expect(confirmDialogOptions('?', 'de').buttons).toEqual(['ОК', 'Отмена'])
  })

  it('shows text only, at most 2000 characters', () => {
    expect(confirmDialogOptions(undefined, 'ru').message).toBe('')
    expect(confirmDialogOptions({ toString: () => 'x' }, 'ru').message).toBe('x')
    expect(confirmDialogOptions('a'.repeat(5000), 'ru').message).toHaveLength(2000)
  })
})
