import type { MessageBoxOptions } from 'electron'

/** The longest text a page's confirmation shows: a page cannot fill the screen with one. */
const MESSAGE_MAX = 2000

/**
 * A page's `window.confirm()` as a dialog of the main process (src/app/nativeConfirm.ts; pure, unit-tested in
 * confirmDialog.test.ts). After Chromium's own confirm dialog closes, the window on Windows takes no typed keys until it
 * is switched away and back (electron#41603): the owner's chat box took no text while the buttons worked (owner,
 * 03.11.2026: «иногда зависает окно чата и невозможно начать печатать»). A main-process dialog gives the keys back.
 * Same choice as before: «ОК» first and the default (Enter), «Отмена» or Esc answers no.
 */
export function confirmDialogOptions(message: unknown, locale: unknown): MessageBoxOptions {
  const english = locale === 'en'
  return {
    type: 'question',
    title: 'Raid OS',
    message: String(message ?? '').slice(0, MESSAGE_MAX),
    buttons: english ? ['OK', 'Cancel'] : ['ОК', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }
}
