import type { SlotKind } from './boardLayout'

/**
 * Faint outlines of what goes into an empty slot (owner, 17.10.2026: «внутренние силуэты модулей, где нет модулей»), our own
 * simple drawings on a 48 × 24 box. They read as a hint behind the slot name, never as an item.
 */
const PATHS: Record<SlotKind | 'ammo', string> = {
  muzzle: 'M4 9h26v6H4z M30 7h14v10H30z M33 9h2v6h-2z M38 9h2v6h-2z',
  gas: 'M8 6h18v12H8z M26 10h16v4H26z M12 9h3v6h-3z',
  barrel: 'M2 10h40v4H2z M42 8h4v8h-4z',
  handguard: 'M4 7h40v10H4z M8 7v10 M14 7v10 M20 7v10 M26 7v10 M32 7v10 M38 7v10',
  receiver: 'M4 8h30l8 5v5H4z M14 10h10v3H14z',
  stock: 'M2 10h14l26-5v15H24l-4-4H2z',
  magazine: 'M18 2h13l-3 20H15z M19 6h10',
  grip: 'M16 4h15l-4 18h-8z',
  charge: 'M6 10h30v4H6z M6 6h5v12H6z',
  sight: 'M14 14h20v4H14z M20 6h8v8h-8z M23 4h2v2h-2z',
  scope: 'M2 8h8v8H2z M10 10h28v4H10z M38 7h8v10h-8z M20 14h8v4h-8z',
  mount: 'M6 12h36v6H6z M8 9h3v3H8z M14 9h3v3h-3z M20 9h3v3h-3z M26 9h3v3h-3z M32 9h3v3h-3z M38 9h3v3h-3z',
  foregrip: 'M12 4h24v4H12z M20 8h8v14h-8z',
  bipod: 'M16 4h16v4H16z M18 8l-8 14h3l7-12z M30 8l8 14h-3l-7-12z',
  tactical: 'M6 8h26v8H6z M32 6h8v12h-8z M10 16h6v3h-6z',
  launcher: 'M4 8h36v8H4z M40 6h4v12h-4z M14 16h6v6h-6z',
  other: 'M22 6h4v12h-4z M18 10h12v4H18z',
  ammo: 'M6 9h26v6H6z M32 9h6l6 3-6 3h-6z M8 9v6',
}

export function SlotSilhouette({ kind }: { kind: SlotKind | 'ammo' }) {
  return <svg className="wb-silhouette" viewBox="0 0 48 24" aria-hidden="true" focusable="false">
    <path d={PATHS[kind]} fill="currentColor" fillRule="evenodd" stroke="currentColor" strokeWidth="0.6" strokeLinejoin="round" />
  </svg>
}
