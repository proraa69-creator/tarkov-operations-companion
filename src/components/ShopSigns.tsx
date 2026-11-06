import { useMemo } from 'react'
import { SVGOverlay } from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { GameMap } from '../domain/types'
import { SHOP_SIGN_FONTS, shopSignsOf, signLines, signThickness, type ShopSign } from '../data/interchangeShopSigns'
import { useLocale } from '../i18n/LocaleProvider'

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
  const layer = map.layers?.find((entry) => entry.name === floor)
  const floorKey = layer?.svgLayer ?? layer?.name
  const signs = useMemo(() => shopSignsOf(map.id, floorKey), [map.id, floorKey])
  // A map turned a quarter (Завод, Лаборатория): game x runs up the screen, so the box's sides swap.
  const turned = (map.coordinateRotation ?? 0) % 180 !== 0
  // The language in the key: an overlay reads its viewBox once.
  return <>{signs.map((sign) => <SignOverlay key={`${sign.floor}:${sign.name}:${locale}`} sign={sign} text={locale === 'en' ? sign.signEn ?? sign.sign : sign.sign} turned={turned} />)}</>
}

/** A line's height in a sign's own drawing; the letters are 0.7 of it. */
const H = 10
const FONT_SIZE = H * 0.7
/** Space at each end of the plate, and before the text when a cross stands at its left. */
const PAD = H * 0.3
const CROSS = H * 0.9
/** Every plate's corners, as ADIK's (owner, 03.11.2026: «рамки у всех должны быть закругленные как у ADIK»): of its height. */
const CORNER = 0.12

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

export function SignOverlay({ sign: source, text, turned = false }: { sign: ShopSign; text?: string; turned?: boolean }) {
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
  const W = (cross ? CROSS : 0) + textW + PAD * 2
  const T = signThickness(sign) * H
  // Along a narrow, tall room the plate is drawn lying and turned a quarter to the left: it reads from bottom to top.
  const attributes = useMemo(() => ({ viewBox: sign.vertical ? `0 0 ${T} ${W}` : `0 0 ${W} ${T}`, preserveAspectRatio: 'xMidYMid meet', class: 'shop-sign', 'aria-hidden': 'true' }), [W, T, sign.vertical])
  return (
    <SVGOverlay bounds={bounds} attributes={attributes} interactive={false} zIndex={7}>
      <g transform={sign.vertical ? `rotate(-90) translate(${-W} 0)` : undefined}>
        <rect x={0} y={0} width={W} height={T} rx={T * CORNER} fill={sign.bg} />
        {sign.accent === 'stripe' && <rect x={T * CORNER} y={T - H * 0.14} width={W - T * CORNER * 2} height={H * 0.1} fill={sign.accentColor ?? sign.fg} />}
        {cross && <path transform={`translate(${PAD * 0.6} ${(T - H) / 2})`} d={`M${H * 0.38} ${H * 0.22}h${H * 0.24}v${H * 0.2}h${H * 0.2}v${H * 0.24}h-${H * 0.2}v${H * 0.2}h-${H * 0.24}v-${H * 0.2}h-${H * 0.2}v-${H * 0.24}h${H * 0.2}z`} fill={sign.accentColor ?? sign.fg} />}
        {lines.map((line, index) => (
          <text
            key={index}
            x={(cross ? CROSS : 0) + PAD + textW / 2}
            y={T / 2 + (index - (lines.length - 1) / 2) * H * 0.8}
            dominantBaseline="central"
            textAnchor="middle"
            fontFamily={font.family}
            fontWeight={font.weight}
            fontStyle={sign.italic ? 'italic' : 'normal'}
            fontSize={FONT_SIZE}
            fill={sign.fg}
          >{line}</text>
        ))}
      </g>
    </SVGOverlay>
  )
}
