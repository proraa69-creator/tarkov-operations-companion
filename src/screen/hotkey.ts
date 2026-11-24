/**
 * A pressed key as an Electron accelerator for the main process's global shortcut («F8», «Ctrl+Shift+L», «Alt+num5»);
 * '' for a key that cannot be one (a modifier alone, Esc, Tab, Enter…). The main process checks it again
 * (electron/screenTuning/state.ts).
 */
export function acceleratorOf(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey'>): string {
  const code = event.code
  let key = ''
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^Numpad[0-9]$/.test(code)) key = `num${code.slice(6)}`
  else if (['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'].includes(code)) key = code
  if (!key) return ''
  return [event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift', key].filter(Boolean).join('+')
}
