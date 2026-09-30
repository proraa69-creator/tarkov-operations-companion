/**
 * «Минимал» marker glyph for the battle pass documents: the TerraGroup statement (sheet, title lines and the
 * Z-shaped logo), drawn with the same props as the lucide icons the other layers use.
 */
export function DocumentGlyph({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="1" />
      <path d="M8 6h8" />
      <path d="M8 10h7l-7 5h7" />
      <path d="M5 18.5h14" />
    </svg>
  )
}
