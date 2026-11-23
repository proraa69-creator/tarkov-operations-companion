/** Loading the range's pictures (src/range/rangeFigures.ts) from their pack: on the PC through the app's own scheme, elsewhere by fetch. */
import { useEffect, useState } from 'react'
import { isDesktopShell } from '../platform'
import { openPartPack, type PartPack } from '../arsenal/partPack'
import { RANGE_PACK_NAME, RANGE_PICTURES_BASE } from './rangePack'
import type { FigureIndex } from './rangeFigures'

let packLoad: Promise<PartPack | null> | null = null
function pack(): Promise<PartPack | null> {
  packLoad ??= fetch(`${import.meta.env.BASE_URL}${RANGE_PACK_NAME}`)
    .then((answer) => (answer.ok ? answer.arrayBuffer() : null))
    .then((bytes) => (bytes ? openPartPack(new Uint8Array(bytes)) : null))
    .catch(() => null)
  return packLoad
}

async function rangeFile(name: string): Promise<Blob | null> {
  if (isDesktopShell()) {
    const answer = await fetch(`${RANGE_PICTURES_BASE}${name}`).catch(() => null)
    return answer?.ok ? answer.blob() : null
  }
  const bytes = await (await pack())?.file(name)
  return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : 'image/webp' }) : null
}

let indexLoad: Promise<FigureIndex | null> | null = null
function loadIndex() {
  indexLoad ??= rangeFile('index.json').then((blob) => (blob ? blob.text().then((text) => JSON.parse(text) as FigureIndex) : null)).catch(() => null)
  return indexLoad
}

const urls = new Map<string, Promise<string | null>>()
/** A picture as an object address (made once). */
export function figureUrl(file: string): Promise<string | null> {
  let load = urls.get(file)
  if (!load) {
    load = rangeFile(file).then((blob) => (blob ? URL.createObjectURL(blob) : null)).catch(() => null)
    urls.set(file, load)
  }
  return load
}

/** The pictures' index, or null while it loads or when the build has none. */
export function useFigureIndex() {
  const [index, setIndex] = useState<FigureIndex | null>(null)
  useEffect(() => {
    let alive = true
    void loadIndex().then((loaded) => { if (alive) setIndex(loaded) })
    return () => { alive = false }
  }, [])
  return index
}

/** Object addresses of pictures, by file, as they load. */
export function useFigureUrls(files: string[]) {
  const key = files.join('|')
  const [loaded, setLoaded] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    for (const file of key ? key.split('|') : []) {
      void figureUrl(file).then((url) => { if (alive && url) setLoaded((current) => (current[file] === url ? current : { ...current, [file]: url })) })
    }
    return () => { alive = false }
  }, [key])
  return loaded
}

const jsons = new Map<string, Promise<unknown>>()
/** A JSON file of the pack (the scopes' data), or null while it loads or when the build has none. */
export function useRangeJson<T>(name: string) {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    let load = jsons.get(name)
    if (!load) {
      load = rangeFile(name).then((blob) => (blob ? blob.text().then((text) => JSON.parse(text) as unknown) : null)).catch(() => null)
      jsons.set(name, load)
    }
    void load.then((loaded) => { if (alive) setValue(loaded as T | null) })
    return () => { alive = false }
  }, [name])
  return value
}
