import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { HangerEngine } from './hangerEngine'

/** Click-through canvas with the swinging kit (dog tags, pulls, carabiners, strap tails). */
export function GearHangers({ reduced, tagLines }: { reduced: boolean; tagLines: [string[], string[]] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<HangerEngine | null>(null)
  const linesRef = useRef(tagLines)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const engine = new HangerEngine(canvas, reduced, linesRef.current)
    engineRef.current = engine
    return () => { engine.dispose(); engineRef.current = null }
  }, [reduced])
  const key = tagLines.flat().join('|')
  useEffect(() => {
    linesRef.current = tagLines
    engineRef.current?.setTagLines(tagLines)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return createPortal(<canvas ref={canvasRef} className="gear-hangers" aria-hidden="true" />, document.body)
}
