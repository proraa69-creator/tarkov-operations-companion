import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopyButton } from './CopyButton'

/** The async clipboard first; where an app's browser refuses it, the copy of a selected text on the same click. */
function setClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
}
function setSelectionCopy(result: boolean) {
  const copied: string[] = []
  const exec = vi.fn(() => { copied.push(document.querySelector('textarea')?.value ?? ''); return result })
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
  return { exec, copied }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('CopyButton', () => {
  it('copies with the async clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    setClipboard(writeText)
    render(<CopyButton value="https://raidos.app/cabinet" />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Скопировано')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith('https://raidos.app/cabinet')
  })

  it('copies the selected text where the clipboard is refused', async () => {
    setClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')))
    const { exec, copied } = setSelectionCopy(true)
    render(<CopyButton value="https://raidos.app/cabinet" />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Скопировано')).toBeInTheDocument()
    expect(exec).toHaveBeenCalledWith('copy')
    expect(copied).toEqual(['https://raidos.app/cabinet'])
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('asks to select by hand when neither copies', async () => {
    setClipboard(() => Promise.reject(new Error('no clipboard')))
    setSelectionCopy(false)
    render(<CopyButton value="https://raidos.app/cabinet" />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByText('Выделите вручную')).toBeInTheDocument()
  })
})
