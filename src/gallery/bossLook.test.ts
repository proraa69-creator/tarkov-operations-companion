// @vitest-environment node
import { MeshStandardMaterial, ShaderLib, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { describe, expect, it } from 'vitest'
import { gradeBossMaterial } from './bossLook'

/** What three.js hands onBeforeCompile: the standard material's shaders, and the renderer as the second argument. */
function compiled(material: MeshStandardMaterial) {
  const shader = { fragmentShader: ShaderLib.physical.fragmentShader, vertexShader: ShaderLib.physical.vertexShader, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms
  material.onBeforeCompile(shader, {} as WebGLRenderer)
  return { fragment: shader.fragmentShader, key: material.customProgramCacheKey() }
}

describe('boss and trader material grade', () => {
  it('grades every model the same way, whatever three.js passes after the shader', () => {
    const material = new MeshStandardMaterial()
    gradeBossMaterial(material)
    const { fragment, key } = compiled(material)
    expect(key).toBe('boss-grade')
    expect(fragment).toContain('float boss_l')
    expect(fragment).not.toMatch(/NaN|Infinity|boss_edge/)
  })

  it('puts Fence in black haze: darker, greyer colours that keep the texture, and a darker silhouette', () => {
    const material = new MeshStandardMaterial()
    gradeBossMaterial(material, 0.85)
    const { fragment, key } = compiled(material)
    expect(key).toBe('boss-grade-haze-0.85')
    expect(fragment).toMatch(/diffuseColor\.rgb, 0\.358\), 0\.0\) \* 0\.473;/)
    expect(fragment).toContain('float boss_edge')
    expect(fragment).not.toMatch(/NaN|Infinity/)
  })
})
