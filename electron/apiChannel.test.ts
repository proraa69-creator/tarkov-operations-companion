// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { API_CHANNEL, dispatchApiMessage, handleApiRequest, onApiEvent, resetApiChannel } from './apiChannel'

afterEach(() => resetApiChannel())

describe('API ↔ owner app channel (electron/apiChannel.ts)', () => {
  it('answers registered requests and refuses unknown ones', async () => {
    handleApiRequest('self-update:status', () => ({ phase: 'idle' }))
    const replies: unknown[] = []
    await dispatchApiMessage({ channel: API_CHANNEL, id: 7, type: 'self-update:status' }, (answer) => replies.push(answer))
    await dispatchApiMessage({ channel: API_CHANNEL, id: 8, type: 'shell:run', payload: 'calc.exe' }, (answer) => replies.push(answer))
    expect(replies).toEqual([
      { channel: API_CHANNEL, replyTo: 7, ok: true, data: { phase: 'idle' } },
      { channel: API_CHANNEL, replyTo: 8, ok: false, error: 'Неизвестный запрос' },
    ])
  })

  it('turns a failing handler into an error answer and ignores foreign messages', async () => {
    handleApiRequest('self-update:rollback', () => { throw new Error('Нет предыдущей версии') })
    const replies: unknown[] = []
    await dispatchApiMessage({ channel: API_CHANNEL, id: 1, type: 'self-update:rollback' }, (answer) => replies.push(answer))
    await dispatchApiMessage({ channel: 'other', id: 2, type: 'self-update:rollback' }, (answer) => replies.push(answer))
    await dispatchApiMessage(null, (answer) => replies.push(answer))
    expect(replies).toEqual([{ channel: API_CHANNEL, replyTo: 1, ok: false, error: 'Нет предыдущей версии' }])
  })

  it('delivers events without an answer', async () => {
    const seen: unknown[] = []
    onApiEvent('error-report', (payload) => seen.push(payload))
    const replies: unknown[] = []
    await dispatchApiMessage({ channel: API_CHANNEL, type: 'error-report', payload: { name: 'TypeError' } }, (answer) => replies.push(answer))
    expect(seen).toEqual([{ name: 'TypeError' }])
    expect(replies).toEqual([])
  })
})
