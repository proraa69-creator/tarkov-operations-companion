/**
 * `window.confirm()` of the desktop app goes through the main process (electron/confirmDialog.ts): after Chromium's own
 * dialog the window on Windows takes no typed keys until it is switched away and back (electron#41603; owner,
 * 03.11.2026: «иногда зависает окно чата и невозможно начать печатать, а остальные кнопки работают»). The answer is the
 * same and still synchronous, so every `window.confirm(…)` of the app stays as it is. The site, the phone app and a
 * main process older than this page keep the browser's own.
 */
export function installNativeConfirm(target: Window = window) {
  const confirm = target.tarkovDesktop?.confirm
  if (!confirm) return false
  target.confirm = (message?: string) => confirm(String(message ?? ''), target.document.documentElement.lang === 'en' ? 'en' : 'ru')
  return true
}
