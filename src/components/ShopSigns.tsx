import { useMemo } from 'react'
import { SVGOverlay } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { GameMap } from '../domain/types'
import { SHOP_SIGN_FONTS, shopSignsOf, signLines, signThickness, type ChessPiece, type ShopSign } from '../data/interchangeShopSigns'
import { useLocale } from '../i18n/LocaleProvider'
import { useHiddenRoomLayers } from '../maps/roomLayers'

/**
 * Развязка, «2 этаж» and «3 этаж» (owner, 03.11.2026: «у каждого магазина в виде сверху должно быть написано название. В
 * стиле этого магазина… процентов на 30 надпись по этой площади посередине… не прям конкретно… а как такой силуэтик»):
 * each shop's name in the colours and lettering of its sign, a translucent plate in the middle of the shop's room
 * (src/data/interchangeShopSigns.ts). Drawn in the map's own coordinates, so it grows and shrinks with the map; on both
 * views, under the markers, never taking a click. Shared by every map that draws a floor (MapFloorLayers), and now on every
 * map with named shops or rooms (owner, 06.11.2026; src/data/mapPlaceSigns.ts).
 */
export function ShopSigns({ map, floor }: { map: GameMap; floor: string }) {
  const { locale } = useLocale()
  const hidden = useHiddenRoomLayers()
  const layer = map.layers?.find((entry) => entry.name === floor)
  const floorKey = layer?.svgLayer ?? layer?.name
  const signs = useMemo(() => shopSignsOf(map.id, floorKey), [map.id, floorKey])
  // A map turned a quarter (Завод, Лаборатория): game x runs up the screen, so the box's sides swap.
  const turned = (map.coordinateRotation ?? 0) % 180 !== 0
  if (hidden.has('places')) return null
  // The language in the key: an overlay reads its viewBox once.
  return <>{signs.map((sign) => <SignOverlay key={`${sign.floor}:${sign.name}:${locale}`} sign={sign} text={locale === 'en' ? sign.signEn ?? sign.sign : sign.sign} turned={turned} zIndex={6} />)}</>
}

/** The pieces, each on a 10 × 10 square; drawn white, or black with a light edge, on the plate. */
const PIECE_PATHS: Record<ChessPiece, string> = {
  king: 'M4.5.5h1v1h1v.9h-1v1c1.6-.5 3 .1 3.2 1.4.1 1-.6 2-1.4 2.6H2.7C1.9 6.8 1.200 5.800 1.300 4.800c.2-1.300 1.600-1.900 3.200-1.400v-1h-1v-.9h1zM2.800 7.300h4.400l.4 1h-5.200zM1.900 8.700h6.200v.9H1.900z',
  queen: 'M1.200 2.900a.7.7 0 1 1 1 .6l1 2.200.5-2.900a.7.7 0 1 1 .9-.1L5 1.900l.4.800a.7.7 0 1 1 .9.1l.5 2.900 1-2.200a.7.7 0 1 1 1-.6c0 .3-.2.600-.4.700L7.300 6.900H2.700L1.600 3.600a.7.7 0 0 1-.4-.7zM2.800 7.300h4.400l.4 1h-5.200zM1.900 8.700h6.200v.9H1.900z',
  rook: 'M2.300 1h1.300v1h1V1h.8v1h1V1h1.300v2.300L6.700 4.300v3H3.300v-3L2.300 3.300zM2.800 7.500h4.400l.4.800h-5.200zM1.900 8.700h6.200v.9H1.900z',
  bishop: 'M5 .5a.8.8 0 0 1 .5 1.400C6.500 2.600 7.200 3.600 7.200 4.600c0 .8-.5 1.400-1.100 1.700.2.400.5.700.8 1H3.100c.3-.3.600-.6.800-1-.6-.3-1.100-.9-1.100-1.700 0-1 .7-2 1.700-2.700A.8.8 0 0 1 5 .5zM2.800 7.500h4.400l.4.800h-5.200zM1.900 8.700h6.200v.9H1.900z',
  knight: 'M3 7.300c0-1.500.7-2.300 1.600-3 .4-.3.6-.7.5-1.100-.5.4-1.100.6-1.700.7l-.9-.7c-.2-.2-.2-.5 0-.7L4 1.200 4.200.4c.5.100 1 .4 1.300.7C7 1.700 8 3.300 8 5.100c0 .8-.1 1.500-.2 2.200zM2.800 7.500h4.400l.4.800h-5.200zM1.900 8.700h6.200v.9H1.900z',
  pawn: 'M5 1a1.600 1.600 0 0 1 1.200 2.700h.5v.7h-1c.1 1 .8 1.900 1.200 2.900H3.100c.4-1 1.100-1.900 1.200-2.900h-1v-.7h.5A1.600 1.600 0 0 1 5 1zM2.800 7.500h4.400l.4.800h-5.200zM1.900 8.700h6.200v.9H1.900z',
}

/** A line's height in a sign's own drawing; the letters are 0.7 of it. */
const H = 10
const FONT_SIZE = H * 0.7
/** Space at each end of the plate, and before the text when a cross stands at its left. */
const PAD = H * 0.3
const CROSS = H * 0.9
const PIECE = H * 0.95
/** Every plate's corners, as ADIK's (owner, 03.11.2026: «рамки у всех должны быть закругленные как у ADIK»): of its height. */
const CORNER = 0.12
/** See-through, so the map shows under it (owner, 06.11.2026: «фон прозрачный, более прозрачный, чтобы все было видно под ним»). */
const PLATE_OPACITY = 0.5

let measureContext: CanvasRenderingContext2D | null | undefined

/** The text's own width in the drawing's units, measured in its font (an estimate where there is no canvas). */
function textWidth(text: string, font: string) {
  if (measureContext === undefined) {
    try { measureContext = document.createElement('canvas').getContext('2d') } catch { measureContext = null }
  }
  if (!measureContext) return text.length * FONT_SIZE * 0.7
  measureContext.font = font
  return measureContext.measureText(text).width
}

export function SignOverlay({ sign: source, text, turned = false, zIndex = 7 }: { sign: ShopSign; text?: string; turned?: boolean; zIndex?: number }) {
  const sign = useMemo(() => (text === undefined ? source : { ...source, sign: text }), [source, text])
  // [lat, lng] = [z, x] (src/data/mapProjection.ts); the box is centred on the shop.
  const bounds = useMemo<LatLngBoundsExpression>(() => {
    const [alongX, alongZ] = turned ? [sign.h, sign.w] : [sign.w, sign.h]
    return [[sign.z - alongZ / 2, sign.x - alongX / 2], [sign.z + alongZ / 2, sign.x + alongX / 2]]
  }, [sign, turned])
  const font = SHOP_SIGN_FONTS[sign.font]
  const lines = signLines(sign)
  const cross = sign.accent === 'cross'
  // The plate fits the text as it is drawn: letters never stretched or squeezed (owner: «не криво»). The overlay keeps
  // the drawing's proportions inside the shop's box, centred.
  const textW = useMemo(() => Math.max(...signLines(sign).map((line) => textWidth(line, `${sign.italic ? 'italic ' : ''}${font.weight} ${FONT_SIZE}px ${font.family}`))), [sign, font])
  const lead = cross ? CROSS : sign.piece ? PIECE : 0
  const W = lead + textW + PAD * 2
  const T = signThickness(sign) * H
  // Along a narrow, tall room the plate is drawn lying and turned a quarter to the left: it reads from bottom to top.
  const attributes = useMemo(() => ({ viewBox: sign.vertical ? `0 0 ${T} ${W}` : `0 0 ${W} ${T}`, preserveAspectRatio: 'xMidYMid meet', class: 'shop-sign', 'aria-hidden': 'true' }), [W, T, sign.vertical])
  return (
    <SVGOverlay bounds={bounds} attributes={attributes} interactive={false} zIndex={zIndex}>
      <g transform={sign.vertical ? `rotate(-90) translate(${-W} 0)` : undefined}>
        <rect x={0} y={0} width={W} height={T} rx={T * CORNER} fill={sign.bg} fillOpacity={PLATE_OPACITY} />
        {sign.accent === 'stripe' && <rect x={T * CORNER} y={T - H * 0.14} width={W - T * CORNER * 2} height={H * 0.1} fill={sign.accentColor ?? sign.fg} />}
        {cross && <path transform={`translate(${PAD * 0.6} ${(T - H) / 2})`} d={`M${H * 0.38} ${H * 0.22}h${H * 0.24}v${H * 0.2}h${H * 0.2}v${H * 0.24}h-${H * 0.2}v${H * 0.2}h-${H * 0.24}v-${H * 0.2}h-${H * 0.2}v-${H * 0.24}h${H * 0.2}z`} fill={sign.accentColor ?? sign.fg} />}
        {sign.piece && <path transform={`translate(${PAD * 0.55} ${(T - PIECE) / 2}) scale(${PIECE / 10})`} d={PIECE_PATHS[sign.piece.kind]} fill={sign.piece.white ? '#f6f3e6' : '#0b0d0b'} stroke={sign.piece.white ? 'none' : '#e9e5d3'} strokeWidth={sign.piece.white ? 0 : 0.5} strokeLinejoin="round" />}
        {lines.map((line, index) => (
          <text
            key={index}
            x={lead + PAD + textW / 2}
            y={T / 2 + (index - (lines.length - 1) / 2) * H * 0.8}
            dominantBaseline="central"
            textAnchor="middle"
            fontFamily={font.family}
            fontWeight={font.weight}
            fontStyle={sign.italic ? 'italic' : 'normal'}
            fontSize={FONT_SIZE}
            fill={sign.fg}
            stroke={sign.bg}
            strokeWidth={0.5}
            paintOrder="stroke"
          >{line}</text>
        ))}
      </g>
    </SVGOverlay>
  )
}
