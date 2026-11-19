/* eslint-disable react-refresh/only-export-components */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Build } from './gunTypes'
import { layBuild, type LaidBuild, type PartsIndex } from './partPictures'

/**
 * Where the part pictures are served (`index.json`, `<id>.webp` colour, `<id>.d.png` depth). The dev server serves them from public/;
 * the app will take them from the server once they are there.
 */
export const PART_PICTURES_BASE = '/gun-parts/'

let indexLoad: Promise<PartsIndex | null> | null = null
export function loadPartsIndex(base = PART_PICTURES_BASE): Promise<PartsIndex | null> {
  indexLoad ??= fetch(`${base}index.json`).then((answer) => (answer.ok ? answer.json() as Promise<PartsIndex> : null)).catch(() => null)
  return indexLoad
}

const pictures = new Map<string, Promise<ImageBitmap | null>>()
/** A picture as its bytes are (no premultiplying, no colour change: a depth picture's numbers must stay as they are). */
function bitmap(url: string): Promise<ImageBitmap | null> {
  let load = pictures.get(url)
  if (!load) {
    load = fetch(url).then((answer) => (answer.ok ? answer.blob() : Promise.reject(new Error(String(answer.status)))))
      .then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
      .catch(() => null)
    pictures.set(url, load)
  }
  return load
}

const VERTEX = `#version 300 es
in vec2 corner;
uniform mat3 place;
uniform vec2 size;
uniform vec2 canvas;
out vec2 uv;
void main() {
  uv = corner;
  vec2 pixel = (place * vec3(corner * size, 1.0)).xy;
  gl_Position = vec4(pixel / canvas * 2.0 - 1.0, 0.0, 1.0);
  gl_Position.y = -gl_Position.y;
}`
// The depth of a pixel: its part's place along the view plus the depth the game measured (16 bits in R and G), as 0…1 over the build;
// a pixel nearer the eye wins. Solid pixels write the depth, the soft edges are laid over what is in front of them.
const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D color;
uniform sampler2D depth;
uniform float origin;
uniform vec2 range;
uniform vec2 span;
uniform bool edges;
out vec4 frag;
void main() {
  vec4 c = texture(color, uv);
  if (edges ? (c.a < 0.02 || c.a >= 0.6) : c.a < 0.6) discard;
  vec4 d = texture(depth, uv);
  float v = (d.r * 255.0 * 256.0 + d.g * 255.0) / 65535.0;
  float x = d.a > 0.5 ? origin + range.x + v * (range.y - range.x) : span.y;
  gl_FragDepth = clamp((x - span.x) / max(1e-6, span.y - span.x), 0.0, 1.0);
  frag = vec4(c.rgb * c.a, c.a);
}`

export interface Drawn { laid: LaidBuild; colors: (ImageBitmap | null)[]; depths: (ImageBitmap | null)[] }

function draw(canvas: HTMLCanvasElement, drawn: Drawn, scale: number) {
  const { laid } = drawn
  const width = Math.max(1, Math.round(laid.width * scale))
  const height = Math.max(1, Math.round(laid.height * scale))
  canvas.width = width
  canvas.height = height
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, depth: true })
  if (!gl) return drawFlat(canvas, drawn, scale)
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return drawFlat(canvas, drawn, scale)
  gl.useProgram(program)
  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
  const corner = gl.getAttribLocation(program, 'corner')
  gl.enableVertexAttribArray(corner)
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0)
  const at = (name: string) => gl.getUniformLocation(program, name)
  gl.uniform2f(at('canvas'), width, height)
  gl.uniform2f(at('span'), laid.near, laid.far)
  gl.uniform1i(at('color'), 0)
  gl.uniform1i(at('depth'), 1)
  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clearDepth(1)
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  const texture = (image: ImageBitmap, unit: number, smooth: boolean) => {
    const made = gl.createTexture()
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, made)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, smooth ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, smooth ? gl.LINEAR : gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return made
  }
  const textures = laid.parts.map((_, index) => {
    const color = drawn.colors[index]
    const depth = drawn.depths[index]
    return color && depth ? [texture(color, 0, true), texture(depth, 1, false)] as const : null
  })
  const pass = (edges: boolean) => {
    gl.uniform1i(at('edges'), edges ? 1 : 0)
    gl.depthMask(!edges)
    if (edges) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) } else gl.disable(gl.BLEND)
    laid.parts.forEach((part, index) => {
      const made = textures[index]
      if (!made) return
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, made[0])
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, made[1])
      const [a, b, c, d, e, f] = part.m
      // column-major 3×3: the part's placing, then the drawing's scale
      gl.uniformMatrix3fv(at('place'), false, new Float32Array([a * scale, d * scale, 0, b * scale, e * scale, 0, c * scale, f * scale, 1]))
      gl.uniform2f(at('size'), part.asset.w, part.asset.h)
      gl.uniform1f(at('origin'), part.x)
      gl.uniform2f(at('range'), part.asset.d[0], part.asset.d[1])
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    })
  }
  pass(false)
  pass(true)
  for (const made of textures) if (made) { gl.deleteTexture(made[0]); gl.deleteTexture(made[1]) }
}

/** Without WebGL 2: the parts far to near, each over the ones behind (no pixel depth). */
function drawFlat(canvas: HTMLCanvasElement, drawn: Drawn, scale: number) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  const order = drawn.laid.parts.map((part, index) => ({ part, index })).sort((a, b) => (b.part.x + b.part.asset.d[1]) - (a.part.x + a.part.asset.d[1]))
  for (const { part, index } of order) {
    const color = drawn.colors[index]
    if (!color) continue
    const [a, b, c, d, e, f] = part.m
    context.setTransform(a * scale, d * scale, b * scale, e * scale, c * scale, f * scale)
    context.drawImage(color, 0, 0)
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
}

/**
 * The build laid out and every part's pictures loaded. `drawn`: the last complete drawing — while the pictures of a new module load,
 * the one before stays (no blink); `ready` once it is this build's. A build with a part that has no picture yet has none.
 */
export function useBuildDrawing(build: Build): { laid: LaidBuild | null; drawn: Drawn | null; ready: boolean } {
  const [index, setIndex] = useState<PartsIndex | null | undefined>(undefined)
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  useEffect(() => { let alive = true; void loadPartsIndex().then((value) => { if (alive) setIndex(value) }); return () => { alive = false } }, [])
  const laid = useMemo(() => (index ? layBuild(build, index) : null), [build, index])
  const drawable = Boolean(laid?.parts.length && !laid.missing.length)
  useEffect(() => {
    if (!laid || !drawable) return
    let alive = true
    void Promise.all([
      Promise.all(laid.parts.map((part) => bitmap(`${PART_PICTURES_BASE}${part.tpl}.webp`))),
      Promise.all(laid.parts.map((part) => bitmap(`${PART_PICTURES_BASE}${part.tpl}.d.png`))),
    ]).then(([colors, depths]) => { if (alive && colors.every(Boolean) && depths.every(Boolean)) setDrawn({ laid, colors, depths }) })
    return () => { alive = false }
  }, [laid, drawable])
  return { laid, drawn: drawable ? drawn : null, ready: drawable && drawn?.laid === laid }
}

/** The drawing at `scale` (CSS pixels per picture pixel), sharp on the screen's pixels. */
export function BuildCanvas({ drawn, scale, className, style }: { drawn: Drawn; scale: number; className?: string; style?: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!canvas.current) return
    const ratio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    draw(canvas.current, drawn, Math.min(1.5, scale * ratio))
  }, [drawn, scale])
  return <canvas ref={canvas} className={className} aria-hidden="true"
    style={{ width: Math.round(drawn.laid.width * scale), height: Math.round(drawn.laid.height * scale), ...style }} />
}

/** The build drawn as one picture from the side, as wide as its box, changing with every module put on or taken off. */
export function BuildPicture({ build, fallback, className }: { build: Build; fallback?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const { drawn } = useBuildDrawing(build)
  useEffect(() => {
    const element = box.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(element.clientWidth))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return <div ref={box} className={`build-picture${drawn ? ' is-ready' : ''}${className ? ` ${className}` : ''}`}>
    {drawn && width > 0 ? <BuildCanvas drawn={drawn} scale={Math.min(1, width / Math.max(1, drawn.laid.width))} /> : fallback}
  </div>
}
