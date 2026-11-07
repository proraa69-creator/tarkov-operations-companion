/**
 * «Минимал» marker glyph for the BTR stops: the carrier from the side, drawn with the same props as the lucide icons the
 * other layers use.
 */
export function BtrGlyph({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 14l3-4h13l4 3v3H3z" />
      <path d="M12 10V7h4v3" />
      <path d="M12 8H6" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  )
}
