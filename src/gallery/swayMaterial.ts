import { Vector2, Vector3, type Material, type Mesh, type Object3D } from 'three'

/**
 * Hanging parts of a boss model (cape, cloth on the hips, dreadlocks) marked by the _SWAY vertex attribute
 * (scripts/bosses/rig-cloth.mjs: x = 0 where the cloth is attached → 1 at its free end, y = 1 on hair).
 * They sag under their weight (the flare an export was modelled with is pulled in towards the legs and
 * down) and trail the model's turning with a springy lag that overshoots and settles.
 */
export interface Sway {
  /** Advance the spring by dt seconds for the model turning at `turnSpeed` rad/s; returns true while still moving. */
  step(turnSpeed: number, dt: number): boolean
}

const DRAPE = 0.45

export function addSway(root: Object3D): Sway | null {
  const lag = { value: new Vector3() }
  const time = { value: 0 }
  let found = false
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh || !mesh.geometry.getAttribute('_sway')) return
    found = true
    mesh.geometry.computeBoundingBox()
    const box = mesh.geometry.boundingBox!
    const centre = { value: new Vector2((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2) }
    const top = { value: box.max.y - box.min.y }
    const floor = { value: box.min.y }
    const material = mesh.material as Material
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uLag: lag, uTime: time, uCentre: centre, uTop: top, uFloor: floor })
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec2 _sway;
uniform vec3 uLag;
uniform float uTime, uTop, uFloor;
uniform vec2 uCentre;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float w = _sway.x;
  if (w > 0.0) {
    float h = (position.y - uFloor) / uTop;
    // weight: the flare is pulled in towards the legs and the cloth drops a little
    vec2 d = transformed.xz - uCentre;
    float r = length(d), r0 = 0.12 * uTop;
    if (r > r0) transformed.xz = uCentre + d * (r0 + (r - r0) * (1.0 - ${DRAPE.toFixed(2)} * w)) / r;
    transformed.y -= ${DRAPE.toFixed(2)} * 0.03 * uTop * w * w;
    // trailing the turn (−lag × arm from the shoulders), livelier on hair, plus a faint flutter
    vec3 arm = transformed - vec3(uCentre.x, uFloor + 0.85 * uTop, uCentre.y);
    float k = w * w * (1.0 + _sway.y * 0.6);
    transformed += -cross(uLag, arm) * 0.16 * k;
    float phase = dot(position, vec3(31.7, 13.1, 23.9)) / uTop;
    transformed.xz += vec2(sin(uTime * 2.1 + phase), cos(uTime * 1.7 + phase)) * 0.004 * uTop * k * (0.3 + length(uLag));
  }
}`)
    }
    material.customProgramCacheKey = () => 'boss-sway'
    material.needsUpdate = true
  })
  if (!found) return null
  const velocity = new Vector3()
  return {
    step(turnSpeed, dt) {
      const target = new Vector3(0, turnSpeed, 0)
      // underdamped spring towards the turning speed: the cloth trails, swings past and settles
      velocity.addScaledVector(target.sub(lag.value), 30 * dt).multiplyScalar(Math.max(0, 1 - 3 * dt))
      lag.value.addScaledVector(velocity, dt * 8).clampLength(0, 2.5)
      time.value += dt
      return lag.value.length() > 0.004 || velocity.length() > 0.004 || Math.abs(turnSpeed) > 0.01
    },
  }
}
