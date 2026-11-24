/**
 * «Минимал» marker glyph for the spawns: the running man of the Scav exit's picture, drawn with the same props as the lucide
 * icons the other layers use.
 */
export function RunnerGlyph({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.4" cy="5.4" r="2.4" />
      <path d="M12.9 10.3l-1.2 2.3-2.3 4.5-3.4 1.2" />
      <path d="M11.7 12.6l3.4 4 -.5 5.1" />
      <path d="M12.9 10.3l-5.2-1.2-2.3 2.3" />
      <path d="M12.9 10.3l4 1.1 1.7-2.3" />
    </svg>
  )
}
