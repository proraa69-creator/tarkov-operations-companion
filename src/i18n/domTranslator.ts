import { isTargetLanguage, type AppLanguage } from './languages'
import { targetText } from './targetText'

/**
 * German, Japanese and Chinese for the English that screens write right in their code (`locale === 'en' ? 'Close' : …`)
 * rather than through uiText: every text of the page and its `title`, `placeholder`, `aria-label` and `alt`, looked up
 * whole in the language's phrases (src/i18n/targetText.ts). Only whole texts are replaced, never part of a word, and only
 * when the phrase has a text in that language; the text React wrote is kept, so a later change of React's own text or of
 * the language puts the right one back.
 */
const ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'alt'] as const
/** Typed or player-written text, code, and anything marked as not to translate. */
const SKIP = 'script, style, textarea, code, pre, input, [translate="no"], [contenteditable="true"], [data-no-translate]'

const sourceText = new WeakMap<Text, string>()
const drawnText = new WeakMap<Text, string>()
const sourceAttribute = new WeakMap<Element, Map<string, string>>()
const drawnAttribute = new WeakMap<Element, Map<string, string>>()
const touchedTexts = new Set<WeakRef<Text>>()
const touchedElements = new Set<WeakRef<Element>>()

function skipped(element: Element | null) {
  return !element || Boolean(element.closest(SKIP))
}

function drawText(node: Text) {
  const value = node.nodeValue ?? ''
  const source = drawnText.get(node) === value ? sourceText.get(node) ?? value : value
  sourceText.set(node, source)
  if (skipped(node.parentElement)) return
  const next = targetText(source)
  if (next === value) return
  if (next === source) { drawnText.delete(node); node.nodeValue = source; return }
  drawnText.set(node, next)
  touchedTexts.add(new WeakRef(node))
  node.nodeValue = next
}

function drawAttribute(element: Element, name: string) {
  const value = element.getAttribute(name)
  if (value === null || skipped(element)) return
  const sources = sourceAttribute.get(element) ?? new Map<string, string>()
  const drawn = drawnAttribute.get(element) ?? new Map<string, string>()
  const source = drawn.get(name) === value ? sources.get(name) ?? value : value
  sources.set(name, source)
  sourceAttribute.set(element, sources)
  const next = targetText(source)
  if (next === value) return
  if (next === source) { drawn.delete(name); element.setAttribute(name, source); return }
  drawn.set(name, next)
  drawnAttribute.set(element, drawn)
  touchedElements.add(new WeakRef(element))
  element.setAttribute(name, next)
}

function drawTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { drawText(root as Text); return }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) {
    const element = root as Element
    if (skipped(element)) return
    for (const name of ATTRIBUTES) if (element.hasAttribute(name)) drawAttribute(element, name)
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) drawText(node as Text)
    else for (const name of ATTRIBUTES) if ((node as Element).hasAttribute(name)) drawAttribute(node as Element, name)
  }
}

/** Puts React's own texts back (the language went back to English or Russian, or changed). */
function restore() {
  for (const reference of touchedTexts) {
    const node = reference.deref()
    if (node && drawnText.get(node) === node.nodeValue) node.nodeValue = sourceText.get(node) ?? node.nodeValue
    if (node) drawnText.delete(node)
  }
  for (const reference of touchedElements) {
    const element = reference.deref()
    const drawn = element && drawnAttribute.get(element)
    if (element && drawn) {
      const sources = sourceAttribute.get(element)
      for (const [name, value] of drawn) if (element.getAttribute(name) === value && sources?.has(name)) element.setAttribute(name, sources.get(name)!)
      drawnAttribute.delete(element)
    }
  }
  touchedTexts.clear()
  touchedElements.clear()
}

/** Starts drawing the page in German, Japanese or Chinese; the returned function stops it and puts the English back. */
export function startDomTranslation(language: AppLanguage): () => void {
  if (!isTargetLanguage(language) || typeof document === 'undefined' || typeof MutationObserver === 'undefined' || typeof WeakRef === 'undefined') return () => {}
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') drawText(record.target as Text)
      else if (record.type === 'attributes' && record.attributeName) drawAttribute(record.target as Element, record.attributeName)
      else for (const node of record.addedNodes) drawTree(node)
    }
  })
  const redraw = () => drawTree(document.body)
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] })
  window.addEventListener('companion-translations-ready', redraw)
  redraw()
  return () => {
    observer.disconnect()
    window.removeEventListener('companion-translations-ready', redraw)
    restore()
  }
}
