/**
 * «Минимал» marker glyph for the power switches (рубильники): the wall box with its lever handle, drawn with the same
 * props as the lucide icons the other layers use.
 */
export function SwitchGlyph({ size = 24, strokeWidth = 2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="1.5" />
      <path d="M12 15V7" />
      <path d="M9.5 6h5" />
      <circle cx="12" cy="16.5" r="1" />
    </svg>
  )
}
