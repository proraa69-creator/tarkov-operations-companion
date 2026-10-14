import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandUiDispatcher, handTarget } from './uiDispatcher'

let hit: (x: number, y: number) => Element | null

beforeEach(() => {
  document.body.innerHTML = `
    <main id="root">
      <button id="ok">OK</button>
      <button id="off" disabled>Off</button>
      <a id="external" href="https://example.com">site</a>
      <a id="internal" href="#/quests">quests</a>
      <input id="text" type="text" />
      <div class="leaflet-container"><button id="marker">pin</button></div>
      <div data-hand-control="off"><button id="danger">wipe</button></div>
      <div id="list" style="overflow-y: auto; height: 100px"><div id="row">row</div></div>
    </main>`
  hit = () => null
  document.elementFromPoint = vi.fn((x: number, y: number) => hit(x, y))
})

afterEach(() => vi.restoreAllMocks())

const $ = (id: string) => document.getElementById(id)!

describe('handTarget', () => {
  it('accepts plain buttons and internal links only', () => {
    expect(handTarget($('ok'))).toBe($('ok'))
    expect(handTarget($('internal'))).toBe($('internal'))
    for (const id of ['off', 'external', 'text', 'marker', 'danger']) expect(handTarget($(id))).toBeNull()
  })
})

describe('HandUiDispatcher', () => {
  it('clicks the pressed element once, after arming the focus guard, without focusing anything', () => {
    const order: string[] = []
    const guard = vi.fn(() => order.push('guard'))
    $('ok').addEventListener('mousedown', () => order.push('mousedown'))
    $('ok').addEventListener('click', () => order.push('click'))
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const windowFocus = vi.spyOn(window, 'focus').mockImplementation(() => {})
    hit = () => $('ok')
    const dispatcher = new HandUiDispatcher(guard)
    expect(dispatcher.press(10, 10)).toBe($('ok'))
    expect($('ok').hasAttribute('data-hand-pressed')).toBe(true)
    expect(dispatcher.click(10, 10)).toBe($('ok'))
    expect(order).toEqual(['guard', 'mousedown', 'click'])
    expect($('ok').hasAttribute('data-hand-pressed')).toBe(false)
    expect(focus).not.toHaveBeenCalled()
    expect(windowFocus).not.toHaveBeenCalled()
  })

  it('a cancelled press dispatches nothing', () => {
    const onClick = vi.fn()
    const onDown = vi.fn()
    $('ok').addEventListener('click', onClick)
    $('ok').addEventListener('mousedown', onDown)
    hit = () => $('ok')
    const dispatcher = new HandUiDispatcher()
    dispatcher.press(10, 10)
    dispatcher.cancel()
    expect(dispatcher.click(10, 10)).toBeNull()
    expect(onClick).not.toHaveBeenCalled()
    expect(onDown).not.toHaveBeenCalled()
  })

  it('never activates blocked targets', () => {
    const dispatcher = new HandUiDispatcher()
    for (const id of ['external', 'text', 'marker', 'danger', 'off']) {
      const onClick = vi.fn()
      $(id).addEventListener('click', onClick)
      hit = () => $(id)
      dispatcher.press(5, 5)
      dispatcher.click(5, 5)
      expect(onClick).not.toHaveBeenCalled()
    }
  })

  it('answers native confirm dialogs with "no" during a hand click and restores them after', () => {
    const original = window.confirm
    let answer: boolean | null = null
    $('ok').addEventListener('click', () => { answer = window.confirm('wipe?') })
    hit = () => $('ok')
    const dispatcher = new HandUiDispatcher()
    dispatcher.press(1, 1)
    dispatcher.click(1, 1)
    expect(answer).toBe(false)
    expect(window.confirm).toBe(original)
  })

  it('marks the hovered element and moves the mark', () => {
    const dispatcher = new HandUiDispatcher()
    hit = () => $('ok')
    dispatcher.hover(1, 1)
    expect($('ok').hasAttribute('data-hand-hover')).toBe(true)
    hit = () => $('internal')
    dispatcher.hover(500, 500)
    expect($('ok').hasAttribute('data-hand-hover')).toBe(false)
    expect($('internal').hasAttribute('data-hand-hover')).toBe(true)
    dispatcher.release()
    expect($('internal').hasAttribute('data-hand-hover')).toBe(false)
  })

  it('snaps to a nearby target when the fingertip is just outside it', () => {
    const dispatcher = new HandUiDispatcher()
    vi.spyOn($('ok'), 'getBoundingClientRect').mockReturnValue(new DOMRect(110, 90, 40, 20))
    hit = (x) => (x > 105 ? $('ok') : null)
    expect(dispatcher.hover(100, 100).target).toBe($('ok'))
  })

  it('scrolls the nearest scrollable container in whole pixels', () => {
    const list = $('list')
    Object.defineProperty(list, 'scrollHeight', { value: 500 })
    Object.defineProperty(list, 'clientHeight', { value: 100 })
    const scrollBy = vi.fn()
    list.scrollBy = scrollBy as typeof list.scrollBy
    hit = () => $('row')
    const dispatcher = new HandUiDispatcher()
    expect(dispatcher.scrollStart(5, 5)).toBe(list)
    dispatcher.scroll(0.5 / window.innerHeight)
    dispatcher.scroll(0.6 / window.innerHeight)
    expect(scrollBy).toHaveBeenCalledTimes(1)
    expect(scrollBy).toHaveBeenCalledWith({ top: 1, behavior: 'instant' })
    dispatcher.scrollEnd()
    dispatcher.scroll(1)
    expect(scrollBy).toHaveBeenCalledTimes(1)
  })
})
