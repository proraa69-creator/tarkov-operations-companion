import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/raidos-ocr-engine-test' } }))
vi.mock('tesseract.js', () => ({ createWorker: vi.fn() }))
const { languageEngine } = await import('./ocrEngine')

/** A stand-in engine: its models and whether it was ended. */
function engines() {
  const made: Array<{ model: string; ended: boolean; terminate: () => Promise<void> }> = []
  const make = async (model: string) => {
    const engine = { model, ended: false, terminate: async () => { engine.ended = true } }
    made.push(engine)
    return engine as never
  }
  return { made, make }
}

describe('an OCR engine for the game\'s language', () => {
  it('is kept while the language stays, and made again (the old one ended) when it changes', async () => {
    const { made, make } = engines()
    const engine = languageEngine(make)
    const first = await engine.get('rus+eng')
    expect(await engine.get('rus+eng')).toBe(first)
    expect(made).toHaveLength(1)
    const german = await engine.get('deu+eng')
    expect(german).not.toBe(first)
    await Promise.resolve()
    expect(made.map((entry) => [entry.model, entry.ended])).toEqual([['rus+eng', true], ['deu+eng', false]])
    expect(engine.model()).toBe('deu+eng')
  })

  it('is ended when dropped (idle, hung), and one that failed to start is tried again', async () => {
    const { made, make } = engines()
    let fail = true
    const engine = languageEngine(async (model) => { if (fail) throw new Error('no model'); return make(model) })
    await expect(engine.get('jpn+eng')).rejects.toThrow('no model')
    fail = false
    await engine.get('jpn+eng')
    engine.drop()
    await Promise.resolve()
    expect(made[0]!.ended).toBe(true)
    expect(engine.model()).toBeNull()
  })
})
