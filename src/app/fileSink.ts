import { useEffect, useRef } from 'react'

/**
 * A file pasted or dragged in goes to the box that is open (owner, 05.11.2026: «Могут также из буфера обмена вставлять файл. Скриншот
 * или переносить мышкой из папки в приложение, и оно должно добавиться»): the chat, the answer to a report, the report's own window.
 * It works wherever the focus and the pointer are: listened to on the window, for the box the event happened in, else for the newest
 * one, so a dialog over a dialog takes it and the one under it does not. Files of a kind the box does not take reach it too: it says so.
 */
export interface FileSink {
  take: (files: File[]) => void
  /** The box's own part of the page. */
  area?: () => HTMLElement | null | undefined
  /**
   * Where the text cursor goes for Ctrl+V when nothing that takes text has it: the players' app has no menu, so with the cursor on nothing
   * the key would do nothing at all.
   */
  focus?: () => void
  dragging?: (on: boolean) => void
}

/** Every file of a paste or a drop: one browser fills `items`, another `files`. */
export function filesOf(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const items = Array.from(data.items ?? []).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
  return items.length ? items : Array.from(data.files ?? [])
}

const carries = (data: DataTransfer | null | undefined, type: string) => Array.from(data?.types ?? []).includes(type)
const takesText = (node: EventTarget | null) => node instanceof HTMLElement && (node.isContentEditable || node.matches('textarea, input:not([type=checkbox], [type=radio], [type=file], [type=button], [type=submit], [type=range], [type=color])'))

const sinks: FileSink[] = []
let depth = 0
let showing = false

function sinkFor(node: EventTarget | null) {
  for (let index = sinks.length - 1; index >= 0; index -= 1) if (node instanceof Node && sinks[index]!.area?.()?.contains(node)) return sinks[index]
  return sinks.at(-1)
}
function show(on: boolean) {
  if (showing === on) return
  showing = on
  for (const sink of sinks) sink.dragging?.(false)
  if (on) sinks.at(-1)?.dragging?.(true)
}

function onPaste(event: ClipboardEvent) {
  const files = filesOf(event.clipboardData)
  if (!files.length) return
  // Text copied from a document may bring its picture along: into a text box it stays text.
  if (takesText(event.target) && carries(event.clipboardData, 'text/plain')) return
  event.preventDefault()
  event.stopPropagation()
  sinkFor(event.target)?.take(files)
}
function onKeyDown(event: KeyboardEvent) {
  if (event.code !== 'KeyV' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || takesText(event.target)) return
  sinkFor(event.target)?.focus?.()
}
function onDragEnter(event: DragEvent) {
  if (!carries(event.dataTransfer, 'Files')) return
  depth += 1
  show(true)
}
function onDragOver(event: DragEvent) {
  if (!carries(event.dataTransfer, 'Files')) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  show(true)
}
function onDragLeave(event: DragEvent) {
  if (!carries(event.dataTransfer, 'Files')) return
  depth -= 1
  if (depth <= 0) { depth = 0; show(false) }
}
function onDrop(event: DragEvent) {
  if (!carries(event.dataTransfer, 'Files')) return
  event.preventDefault()
  event.stopPropagation()
  depth = 0
  show(false)
  const files = filesOf(event.dataTransfer)
  if (files.length) sinkFor(event.target)?.take(files)
}

const LISTENERS = [['paste', onPaste], ['keydown', onKeyDown], ['dragenter', onDragEnter], ['dragover', onDragOver], ['dragleave', onDragLeave], ['drop', onDrop]] as const

function addSink(sink: FileSink) {
  if (!sinks.length) for (const [name, listener] of LISTENERS) window.addEventListener(name, listener as EventListener, true)
  sinks.push(sink)
  return () => {
    sink.dragging?.(false)
    sinks.splice(sinks.indexOf(sink), 1)
    if (sinks.length) return
    depth = 0
    showing = false
    for (const [name, listener] of LISTENERS) window.removeEventListener(name, listener as EventListener, true)
  }
}

/** While `enabled`, files pasted or dropped anywhere come to this box. */
export function useFileSink(enabled: boolean, sink: FileSink) {
  const latest = useRef(sink)
  useEffect(() => { latest.current = sink })
  useEffect(() => {
    if (!enabled) return
    return addSink({
      take: (files) => latest.current.take(files),
      area: () => latest.current.area?.(),
      focus: () => latest.current.focus?.(),
      dragging: (on) => latest.current.dragging?.(on),
    })
  }, [enabled])
}
