export interface GameLandmark {
  name: string
  x: number
  z: number
}

export interface WikiNamedPoint {
  title: string
  position: [number, number]
  categoryId?: string
}

export interface WikiCalibrationPair {
  name: string
  gameX: number
  gameZ: number
  wikiX: number
  wikiY: number
}

export interface SimilarityTransform {
  a: number
  b: number
  tx: number
  ty: number
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function scoreLandmarkName(landmark: string, title: string) {
  const query = normalizeName(landmark)
  const name = normalizeName(title)
  if (!query || !name) return 0
  if (name === query) return 100
  if (name.startsWith(`${query} `) || query.startsWith(`${name} `)) return 88
  const shorter = query.length <= name.length ? query : name
  const longer = query.length <= name.length ? name : query
  if (shorter.length >= 8 && longer.includes(shorter) && shorter.length / longer.length >= 0.55) return 72
  return 0
}

export function matchLandmarkPairs(landmarks: GameLandmark[], wikiPoints: WikiNamedPoint[]): WikiCalibrationPair[] {
  const extracts = wikiPoints.filter((point) => !point.categoryId || /^exfil_/i.test(point.categoryId))
  const pool = extracts.length ? extracts : wikiPoints
  const candidates: Array<{ score: number; landmark: GameLandmark; wiki: WikiNamedPoint }> = []
  for (const landmark of landmarks) {
    for (const wiki of pool) {
      const score = scoreLandmarkName(landmark.name, wiki.title)
      if (score >= 88) candidates.push({ score, landmark, wiki })
    }
  }
  candidates.sort((left, right) => right.score - left.score)
  const usedLandmarks = new Set<string>()
  const usedWiki = new Set<WikiNamedPoint>()
  const pairs: WikiCalibrationPair[] = []
  for (const candidate of candidates) {
    const key = `${candidate.landmark.name}:${candidate.landmark.x}:${candidate.landmark.z}`
    if (usedLandmarks.has(key) || usedWiki.has(candidate.wiki)) continue
    usedLandmarks.add(key)
    usedWiki.add(candidate.wiki)
    pairs.push({
      name: candidate.landmark.name,
      gameX: candidate.landmark.x,
      gameZ: candidate.landmark.z,
      wikiX: candidate.wiki.position[0],
      wikiY: candidate.wiki.position[1],
    })
  }
  return pairs
}

export function fitSimilarityTransform(pairs: WikiCalibrationPair[]): SimilarityTransform | undefined {
  if (pairs.length < 2) return undefined
  const count = pairs.length
  const meanGX = pairs.reduce((sum, pair) => sum + pair.gameX, 0) / count
  const meanGZ = pairs.reduce((sum, pair) => sum + pair.gameZ, 0) / count
  const meanWX = pairs.reduce((sum, pair) => sum + pair.wikiX, 0) / count
  const meanWY = pairs.reduce((sum, pair) => sum + pair.wikiY, 0) / count
  let c1 = 0
  let c2 = 0
  let norm = 0
  for (const pair of pairs) {
    const gx = pair.gameX - meanGX
    const gz = pair.gameZ - meanGZ
    const wx = pair.wikiX - meanWX
    const wy = pair.wikiY - meanWY
    c1 += gx * wx + gz * wy
    c2 += gx * wy - gz * wx
    norm += gx * gx + gz * gz
  }
  if (norm < 1e-6) return undefined
  const a = c1 / norm
  const b = c2 / norm
  return {
    a,
    b,
    tx: meanWX - a * meanGX + b * meanGZ,
    ty: meanWY - b * meanGX - a * meanGZ,
  }
}

export function applySimilarityTransform(transform: SimilarityTransform, gameX: number, gameZ: number): [number, number] {
  return [
    transform.a * gameX - transform.b * gameZ + transform.tx,
    transform.b * gameX + transform.a * gameZ + transform.ty,
  ]
}

export function fitRobustSimilarity(pairs: WikiCalibrationPair[], maxError = 140): SimilarityTransform | undefined {
  if (pairs.length < 2) return undefined
  if (pairs.length === 2) return fitSimilarityTransform(pairs)

  let bestInliers: WikiCalibrationPair[] = []
  const consider = (seed: WikiCalibrationPair[]) => {
    const fitted = fitSimilarityTransform(seed)
    if (!fitted) return
    const inliers = pairs.filter((pair) => {
      const [wikiX, wikiY] = applySimilarityTransform(fitted, pair.gameX, pair.gameZ)
      return Math.hypot(wikiX - pair.wikiX, wikiY - pair.wikiY) <= maxError
    })
    if (inliers.length > bestInliers.length) bestInliers = inliers
  }

  const count = pairs.length
  if (count <= 24) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) consider([pairs[i], pairs[j]])
    }
  } else {
    for (let sample = 0; sample < 80; sample += 1) {
      const i = Math.floor(Math.random() * count)
      const j = (i + 1 + Math.floor(Math.random() * (count - 1))) % count
      consider([pairs[i], pairs[j]])
    }
  }
  consider(pairs)
  if (bestInliers.length >= 2) return fitSimilarityTransform(bestInliers)
  return fitSimilarityTransform(pairs)
}
