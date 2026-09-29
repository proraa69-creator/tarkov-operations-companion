import {
  DirectionalLight, HemisphereLight, NeutralToneMapping, PMREMGenerator, SRGBColorSpace,
  type Material, type Scene, type WebGLRenderer, type WebGLProgramParametersWithUniforms,
} from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * The one look of the boss models, shared by the Gallery 3D viewer and the pre-rendered Overview stills
 * (scripts/bosses/figure.ts), so both always match.
 *
 * Why the models used to look like toys: the Tripo roughness maps are far too glossy (Killa ~0.31, Knight ~0.32,
 * one model a flat 0.34), so cotton trousers and canvas vests reflected like wet plastic; AgX tone mapping greyed
 * the colours out; and a strong hemisphere light flattened the shading. Now:
 * - Khronos PBR Neutral tone mapping: keeps the texture colours as painted, rolls highlights off without clipping;
 * - a warm key, a soft fill, a cool rim and a dim hemisphere, plus a faint room reflection (RoomEnvironment),
 *   so forms get real light and shadow sides instead of an even wash;
 * - material correction in the shader: fabric/leather/skin roughness is pulled into a physical range (metal keeps
 *   its gloss) and the pale base colours get a moderate saturation lift in linear space (no neon).
 */
export const BOSS_EXPOSURE = 1.08
const ENV_INTENSITY = 0.5
/** Dielectric roughness floor: r' = floor + (1 − floor)·r (0.3 → 0.69, 0.5 → 0.78). */
const ROUGH_FLOOR = 0.55
/** Base colour saturation in linear light. */
const SATURATION = 1.12

export function applyBossLighting(renderer: WebGLRenderer, scene: Scene): () => void {
  renderer.toneMapping = NeutralToneMapping
  renderer.toneMappingExposure = BOSS_EXPOSURE
  renderer.outputColorSpace = SRGBColorSpace
  const pmrem = new PMREMGenerator(renderer)
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.environment = environment
  scene.environmentIntensity = ENV_INTENSITY
  scene.add(new HemisphereLight(0xf1e6cf, 0x1b1d17, 0.3))
  const key = new DirectionalLight(0xfff1dc, 2.4); key.position.set(-2.2, 3.2, 3); scene.add(key)
  const rim = new DirectionalLight(0x9fc4dc, 1.6); rim.position.set(2.6, 1.8, -2.6); scene.add(rim)
  const fill = new DirectionalLight(0xd9c79b, 0.45); fill.position.set(2.5, 0.5, 3); scene.add(fill)
  return () => environment.dispose()
}

/** GLSL edits for the model's MeshStandardMaterial (used from an onBeforeCompile, see gradeBossMaterial). */
export function gradeBossShader(shader: WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
{
  float boss_l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = max(mix(vec3(boss_l), diffuseColor.rgb, ${SATURATION.toFixed(3)}), 0.0);
}`)
    // after metalness is known: matte dielectrics, metal keeps (most of) its own roughness
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
roughnessFactor = mix(${ROUGH_FLOOR.toFixed(3)} + ${(1 - ROUGH_FLOOR).toFixed(3)} * roughnessFactor, max(roughnessFactor, 0.3), metalnessFactor);`)
}

/** Applies the grade to a material that is not patched otherwise (the sway material chains it itself). */
export function gradeBossMaterial(material: Material) {
  material.onBeforeCompile = gradeBossShader
  material.customProgramCacheKey = () => 'boss-grade'
  material.needsUpdate = true
}
