import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { HangerEngine } from './hangerEngine'
import { isAppActive, onAppActivityChange } from '../../app/appActivity'

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
    // asleep while the window is not in use (the player is in the game)
    engine.setActive(isAppActive())
    const stopFollowing = onAppActivityChange((active) => engine.setActive(active))
    return () => { stopFollowing(); engine.dispose(); engineRef.current = null }
  }, [reduced])
  const key = tagLines.flat().join('|')
  useEffect(() => {
    linesRef.current = tagLines
    engineRef.current?.setTagLines(tagLines)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return createPortal(<canvas ref={canvasRef} className="gear-hangers" aria-hidden="true" />, document.body)
}
