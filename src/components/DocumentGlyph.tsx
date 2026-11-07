import { DOCUMENT_FOLDER_PICTURE } from '../assets/documentMarkers'

/**
 * The battle pass documents' layer in the list of layers: the folder the owner sent, turned 90° left (owner, 05.11.2026: the old
 * sheet looked like the doors' sign). Takes the same props as the lucide icons the other layers use; the points on the map show
 * their own kind's picture (assets/documentMarkers.ts).
 */
export function DocumentGlyph({ size = 24 }: { size?: number; strokeWidth?: number }) {
  return <img src={DOCUMENT_FOLDER_PICTURE} width={size} height={size} alt="" draggable={false} />
}
