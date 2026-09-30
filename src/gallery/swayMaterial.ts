import { BufferAttribute, Vector2, type Mesh, type Material, type WebGLProgramParametersWithUniforms } from 'three'
import { gradeBossShader } from './bossLook'
import type { SwayWeights } from './swayWeights'

/**
 * Secondary motion of the loose parts of a boss model — capes, coat hems, loincloths, hoods, straps, slings,
 * ropes, hair and dreads, antennas, pouches — and whole pieces (holsters, backpacks, buckles) that turn a little about
 * their own pivot as one. Per-vertex weights (_sway: x = swing 0..1, 0 wherever the part is fused to the
 * body; y = liveliness of hair, dreads, cords, slings and antennas; _part: pivot xyz and amount of a whole piece)
 * come from swayWeights.ts. The body, head, arms, legs and weapons stay exactly where they are (weight 0).
 *
 * One damped spring per model, stepped on the CPU from the turntable's angular velocity:
 * - turning makes the cloth trail behind (a small rotation about the body axis, growing towards the free
 *   ends), overshoot a little when the turn stops, and settle within about two seconds;
 * - fast turns flare the hems outwards a touch (centrifugal);
 * - an optional very light breeze for the idle view.
 * All displacements stay within a few percent of the model height, so nothing stretches visibly.
 */
export interface Sway {
  /** Advance by dt seconds for the model turning at `turnSpeed` rad/s; returns true while the cloth still moves. */
  step(turnSpeed: number, dt: number, breeze: number): boolean
  /** Fill in the weights once they are computed (until then the model is rigid). */
  setWeights(data: SwayWeights): void
}

const TRAIL = 0.085 // s: steady trailing angle per rad/s of turning
const MAX_ANGLE = 0.28
const FREQUENCY = 1.4 // Hz
const DAMPING = 0.24 // ratio: a visible overshoot or two when a turn stops
const K = (2 * Math.PI * FREQUENCY) ** 2
const D = 2 * DAMPING * Math.sqrt(K)

export function addSway(mesh: Mesh): Sway {
  const count = mesh.geometry.getAttribute('position').count
  const attribute = new BufferAttribute(new Float32Array(count * 2), 2)
  mesh.geometry.setAttribute('_sway', attribute)
  const partAttribute = new BufferAttribute(new Float32Array(count * 4), 4)
  mesh.geometry.setAttribute('_part', partAttribute)
  const uniforms = {
    uSwing: { value: 0 },
    uFlare: { value: 0 },
    uBreeze: { value: 0 },
    uTime: { value: 0 },
    uPivot: { value: new Vector2() },
    uHeight: { value: 1 },
  }
  const material = mesh.material as Material
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    gradeBossShader(shader)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 _sway;
attribute vec4 _part;
uniform float uSwing, uFlare, uBreeze, uTime, uHeight;
uniform vec2 uPivot;
vec3 swayTurn(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
if (_sway.x > 0.0) {
  // livelier parts (hair, dreads, cords, slings: _sway.y) swing further and keep a lever arm even close to the axis
  float k = _sway.x * (1.0 + 0.8 * _sway.y);
  vec2 r = transformed.xz - uPivot;
  float lr = length(r);
  vec2 around = lr > 1e-5 ? vec2(-r.y, r.x) / lr : vec2(0.0);
  float lever = max(lr, uHeight * 0.1 * _sway.y);
  // trailing the turn: rotation by -uSwing about the body axis, weighted
  transformed.xz += uSwing * k * around * lever;
  // centrifugal flare and the lift that keeps the length
  if (lr > 1e-5) transformed.xz += r / lr * uFlare * k * uHeight;
  transformed.y += uFlare * k * k * uHeight * 0.35;
  // breeze: slow waves running down the cloth
  float phase = (position.y / uHeight) * 7.0 + dot(position.xz, vec2(9.1, 6.3)) / uHeight;
  transformed.xz += uBreeze * k * (1.0 + 1.5 * _sway.y) * uHeight * 0.0055 * vec2(sin(uTime * 1.7 - phase), sin(uTime * 1.25 - phase * 0.8 + 1.3));
}
if (_part.w > 0.0) {
  // a whole piece (holster, backpack, buckle) turns about its pivot as one: its lower end trails the turn
  // sideways and sways a little left-right (and a touch in-out) in the breeze
  vec3 pv = _part.xyz;
  vec2 pr = pv.xz - uPivot;
  float pl = length(pr);
  vec2 radial = pl > 1e-5 ? pr / pl : vec2(0.0, -1.0);
  float seed = dot(pv, vec3(11.3, 7.1, 5.7)) / uHeight;
  float side = -uSwing * 0.3 + uBreeze * 0.06 * sin(uTime * 2.1 + seed);
  float out_ = uBreeze * 0.035 * sin(uTime * 1.6 + seed * 1.7 + 1.1);
  vec3 d = transformed - pv;
  d = swayTurn(d, vec3(radial.x, 0.0, radial.y), side * _part.w);
  d = swayTurn(d, vec3(-radial.y, 0.0, radial.x), out_ * _part.w);
  transformed = pv + d;
}`)
  }
  material.customProgramCacheKey = () => 'boss-grade-sway'
  material.needsUpdate = true

  let angle = 0, velocity = 0, active = false
  return {
    setWeights(data) {
      (attribute.array as Float32Array).set(data.weights.subarray(0, count * 2))
      attribute.needsUpdate = true
      if (data.parts) {
        (partAttribute.array as Float32Array).set(data.parts.subarray(0, count * 4))
        partAttribute.needsUpdate = true
      }
      uniforms.uPivot.value.set(data.pivotX, data.pivotZ)
      uniforms.uHeight.value = data.height
      active = true
    },
    step(turnSpeed, dt, breeze) {
      if (!active) return false
      const target = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, TRAIL * turnSpeed))
      const steps = Math.max(1, Math.ceil(dt * 120))
      const h = dt / steps
      for (let s = 0; s < steps; s++) {
        velocity += (K * (target - angle) - D * velocity) * h
        angle += velocity * h
      }
      angle = Math.max(-MAX_ANGLE * 1.3, Math.min(MAX_ANGLE * 1.3, angle))
      const flare = Math.min(0.02, 0.0022 * turnSpeed * turnSpeed)
      uniforms.uFlare.value += (flare - uniforms.uFlare.value) * Math.min(1, dt * 5)
      uniforms.uSwing.value = angle
      uniforms.uBreeze.value = breeze
      uniforms.uTime.value += dt
      return Math.abs(angle) > 5e-4 || Math.abs(velocity) > 2e-3 || Math.abs(target) > 5e-4 || uniforms.uFlare.value > 1e-4
    },
  }
}
