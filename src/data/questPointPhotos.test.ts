import { describe, expect, it, vi } from 'vitest'

const request = vi.fn()
vi.mock('../account/nicknameBinding', () => ({ serviceClient: () => request }))

const { questPointPhotoUrl } = await import('./questPointPhotos')

// owner, 20.11.2026: «чтобы они загружались постепенно. Один загрузился, потом другой, а не всю пачку сразу»
describe('the photos of quest points', () => {
  it('are downloaded one at a time: the next one is asked for once the one before has come or failed', async () => {
    const answers: Array<(value: unknown) => void> = []
    request.mockImplementation(() => new Promise((resolve) => answers.push(resolve)))
    const first = questPointPhotoUrl('a'.repeat(24))
    const second = questPointPhotoUrl('b'.repeat(24))
    const third = questPointPhotoUrl('c'.repeat(24))
    await Promise.resolve(); await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
    answers[0]!({ mime: 'image/jpeg', data: 'AAA' })
    await expect(first).resolves.toBe('data:image/jpeg;base64,AAA')
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    // a photo that fails does not hold the rest back
    answers[1]!(null)
    await expect(second).rejects.toThrow()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3))
    answers[2]!({ mime: 'image/png', data: 'CCC' })
    await expect(third).resolves.toBe('data:image/png;base64,CCC')
    // a photo read once is not asked for again
    await questPointPhotoUrl('a'.repeat(24))
    expect(request).toHaveBeenCalledTimes(3)
  })
})
