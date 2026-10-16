// Synthetic meshes for the tests of the loose-part analysis (swayWeights.ts) and the physics (physics/): a body
// column 1 tall and a cape fused to its back.
const SIDES = 24, ROWS = 40

/** A closed 24-sided column (radius 0.1, 1 tall) standing for the body. */
export function body(positions: number[], indices: number[]) {
  const base = positions.length / 3
  for (let r = 0; r <= ROWS; r++) for (let k = 0; k < SIDES; k++) {
    const a = (k / SIDES) * Math.PI * 2
    positions.push(Math.cos(a) * 0.1, 1 - r / ROWS, Math.sin(a) * 0.1)
  }
  const v = (r: number, k: number) => base + r * SIDES + (k % SIDES)
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < SIDES; k++) indices.push(v(r, k), v(r + 1, k), v(r + 1, k + 1), v(r, k), v(r + 1, k + 1), v(r, k + 1))
  const top = positions.length / 3, bottom = top + 1
  positions.push(0, 1, 0, 0, 0, 0)
  for (let k = 0; k < SIDES; k++) indices.push(top, v(0, k + 1), v(0, k), bottom, v(ROWS, k), v(ROWS, k + 1))
  return { from: base, to: positions.length / 3, vertex: v }
}

/**
 * A cape: a 6 mm sheet fused to the back of the body along one row at shoulder height (its first row of
 * inner vertices are body vertices), leaning away from the back and hanging 0.55 down.
 */
export function cape(positions: number[], indices: number[], column: ReturnType<typeof body>) {
  const row = 4 // y = 0.9
  const left = column.vertex(row, 16), right = column.vertex(row, 20) // around the back (-z)
  const at = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
  const [lx, , lz] = at(left), [rx, , rz] = at(right)
  const base = positions.length / 3
  const STEPS = 24
  for (let s = 1; s <= STEPS; s++) {
    const t = s / STEPS
    const y = 0.9 - 0.55 * t
    const back = 0.07 * Math.min(1, t * 3)
    positions.push(lx, y, lz - back, rx, y, rz - back, rx, y, rz - back - 0.006, lx, y, lz - back - 0.006)
  }
  const v = (s: number, c: number) => (s === 0 ? [left, right, right, left][c % 4] : base + (s - 1) * 4 + (c % 4))
  for (let s = 0; s < STEPS; s++) for (let c = 0; c < 4; c++) {
    const a = v(s, c), b = v(s + 1, c), d = v(s + 1, c + 1), e = v(s, c + 1)
    if (a !== e) indices.push(a, b, d, a, d, e); else indices.push(a, b, d)
  }
  indices.push(v(STEPS, 0), v(STEPS, 2), v(STEPS, 1), v(STEPS, 0), v(STEPS, 3), v(STEPS, 2))
  return { from: base, to: positions.length / 3 }
}

/**
 * A radio antenna: a thin square rod (8 mm) standing up through the top of the body at x = 0.06, from inside it (y 0.9)
 * to y 1.25 — the model is then 1.25 tall. Its rows are 1 cm apart.
 */
export function antenna(positions: number[], indices: number[]) {
  const base = positions.length / 3
  const ROWS = 35, HALF = 0.004
  for (let r = 0; r <= ROWS; r++) {
    const y = 0.9 + (0.35 * r) / ROWS
    positions.push(0.06 - HALF, y, -HALF, 0.06 + HALF, y, -HALF, 0.06 + HALF, y, HALF, 0.06 - HALF, y, HALF)
  }
  const v = (r: number, c: number) => base + r * 4 + (c % 4)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < 4; c++) indices.push(v(r, c), v(r + 1, c), v(r + 1, c + 1), v(r, c), v(r + 1, c + 1), v(r, c + 1))
  indices.push(v(ROWS, 0), v(ROWS, 2), v(ROWS, 1), v(ROWS, 0), v(ROWS, 3), v(ROWS, 2))
  return { from: base, to: positions.length / 3 }
}
