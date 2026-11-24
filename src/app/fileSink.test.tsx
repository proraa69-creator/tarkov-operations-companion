import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesOf, useFileSink } from './fileSink'

const png = (name = 'shot.png') => new File([new Uint8Array([1])], name, { type: 'image/png' })
const fileItem = (file: File) => ({ kind: 'file', type: file.type, getAsFile: () => file })

function Box({ name, take, focus = false }: { name: string; take: (files: File[]) => void; focus?: boolean }) {
  const area = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useFileSink(true, { take, area: () => area.current, focus: () => { if (focus) input.current?.focus() } })
  return <div ref={area} data-testid={name}><textarea ref={input} aria-label={`${name} text`} /><button type="button">{name} button</button></div>
}

afterEach(cleanup)

// Owner, 05.11.2026: «Могут также из буфера обмена вставлять файл. Скриншот или переносить мышкой из папки в приложение».
describe('files pasted or dropped anywhere', () => {
  it('a paste with the cursor on nothing reaches the open box', () => {
    const take = vi.fn()
    render(<Box name="chat" take={take} />)
    const file = png()
    const event = fireEvent.paste(document.body, { clipboardData: { items: [fileItem(file)], types: ['Files'] } })
    expect(take).toHaveBeenCalledWith([file])
    expect(event).toBe(false)
  })

  it('a text paste stays a text paste; text with its picture stays text in a text box, and a file in the box comes through', () => {
    const take = vi.fn()
    render(<Box name="chat" take={take} />)
    const box = screen.getByRole('textbox')
    expect(fireEvent.paste(box, { clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }], types: ['text/plain'] } })).toBe(true)
    expect(fireEvent.paste(box, { clipboardData: { items: [fileItem(png())], types: ['text/plain', 'text/html', 'Files'] } })).toBe(true)
    expect(take).not.toHaveBeenCalled()
    expect(fireEvent.paste(box, { clipboardData: { items: [fileItem(png())], types: ['Files'] } })).toBe(false)
    expect(take).toHaveBeenCalledTimes(1)
  })

  it('a file dragged from a folder and dropped anywhere is taken, never opened by the app', () => {
    const take = vi.fn()
    render(<Box name="chat" take={take} />)
    const file = png('dropped.png')
    expect(fireEvent.dragOver(document.body, { dataTransfer: { types: ['Files'], files: [file] } })).toBe(false)
    expect(fireEvent.drop(document.body, { dataTransfer: { types: ['Files'], files: [file] } })).toBe(false)
    expect(take).toHaveBeenCalledWith([file])
  })

  it('a drag of anything else is left alone', () => {
    const take = vi.fn()
    render(<Box name="chat" take={take} />)
    expect(fireEvent.dragOver(document.body, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true)
    expect(fireEvent.drop(document.body, { dataTransfer: { types: ['text/plain'], files: [] } })).toBe(true)
    expect(take).not.toHaveBeenCalled()
  })

  it('a file of a kind the box does not take reaches it, so the box can say so', () => {
    const take = vi.fn()
    render(<Box name="chat" take={take} />)
    const text = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.paste(document.body, { clipboardData: { items: [fileItem(text)], types: ['Files'] } })
    expect(take).toHaveBeenCalledWith([text])
  })

  it('with several open: the box the event happened in, else the newest; a box that closes stops taking', () => {
    const under = vi.fn()
    const over = vi.fn()
    const { rerender } = render(<><Box key="under" name="under" take={under} /><Box key="over" name="over" take={over} /></>)
    const paste = (node: Element | Document['body']) => fireEvent.paste(node, { clipboardData: { items: [fileItem(png())], types: ['Files'] } })
    paste(document.body)
    expect([under.mock.calls.length, over.mock.calls.length]).toEqual([0, 1])
    paste(screen.getByRole('button', { name: 'under button' }))
    expect([under.mock.calls.length, over.mock.calls.length]).toEqual([1, 1])
    rerender(<Box key="under" name="under" take={under} />)
    paste(document.body)
    expect(under.mock.calls.length).toBe(2)
    cleanup()
    paste(document.body)
    expect(under.mock.calls.length).toBe(2)
  })

  it('Ctrl+V with the cursor on nothing puts it in the box first: the players\' app has no menu to paste from', () => {
    render(<Box name="chat" take={vi.fn()} focus />)
    const button = screen.getByRole('button', { name: 'chat button' })
    button.focus()
    // On a Russian keyboard too: the key's place, not its letter.
    fireEvent.keyDown(button, { code: 'KeyV', key: 'м', ctrlKey: true })
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('reads the files of either field', () => {
    const file = png()
    expect(filesOf({ items: [fileItem(file)], files: [] } as unknown as DataTransfer)).toEqual([file])
    expect(filesOf({ files: [file] } as unknown as DataTransfer)).toEqual([file])
    expect(filesOf(null)).toEqual([])
  })
})
