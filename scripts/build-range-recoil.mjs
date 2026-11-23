#!/usr/bin/env node
/**
 * The recoil of every weapon for «Тир» (src/range/rangeRecoil.ts; owner, 22.11.2026: «при автоматической стрельбе отдачу, как в
 * игре… в зависимости от патрона, от оружия, от сборки»): the fields of the game's "new recoil" the live catalogue (tarkov.dev)
 * does not carry, read from an SPT server's item templates (`templates/items.json`, the game's own). The base vertical force,
 * the fire rate and the mods' and rounds' recoil come from the live catalogue.
 *
 *   node scripts/build-range-recoil.mjs <SPT_Data/database> [out = src/range/rangeRecoil.json]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [, , databaseArg, outArg] = process.argv
if (!databaseArg) {
  console.error('usage: node scripts/build-range-recoil.mjs <SPT_Data/database> [out]')
  process.exit(1)
}
const items = JSON.parse(readFileSync(join(databaseArg, 'templates', 'items.json'), 'utf8'))
const pair = (value, fallback) => [Number(value?.x ?? fallback[0]), Number(value?.y ?? fallback[1])]
const weapons = {}
for (const [id, item] of Object.entries(items)) {
  const p = item._props ?? {}
  if (typeof p.RecoilForceUp !== 'number' || typeof p.RecoilStableIndexShot !== 'number') continue
  weapons[id] = {
    up: p.RecoilForceUp,
    angle: p.RecoilAngle,
    dispersion: p.RecolDispersion,
    camera: p.RecoilCamera,
    stableShot: p.RecoilStableIndexShot,
    stableStep: p.RecoilStableAngleIncreaseStep,
    stableAngle: pair(p.ProgressRecoilAngleOnStable, [0, 0]),
    damping: p.RecoilDampingHandRotation,
    returnSpeed: p.RecoilReturnSpeedHandRotation,
    category: p.RecoilCategoryMultiplierHandRotation,
    returnOffset: p.RecoilReturnPathOffsetHandRotation,
    returnDamping: p.RecoilReturnPathDampingHandRotation,
    postVertical: pair(p.PostRecoilVerticalRangeHandRotation, [0, 0]),
    postHorizontal: pair(p.PostRecoilHorizontalRangeHandRotation, [0, 0]),
    resetAfterShot: Boolean(p.ResetAfterShot),
    groups: (p.ShotsGroupSettings ?? []).map((group) => ({
      start: group.StartShotIndex, end: group.EndShotIndex,
      rotation: pair(group.ShotRecoilRotationStrength, [0, 0]), angle: pair(group.ShotRecoilRadianRange, [0, 0]),
    })),
    cameraSpeed: pair(p.CameraToWeaponAngleSpeedRange, [0.1, 0.2]),
    cameraStep: p.CameraToWeaponAngleStep ?? 0.1,
    fireRate: p.bFirerate,
  }
}
const out = resolve(outArg ?? 'src/range/rangeRecoil.json')
writeFileSync(out, `${JSON.stringify({ source: 'SPT items.json (game 0.16.9)', weapons })}\n`)
console.log(`${Object.keys(weapons).length} weapons -> ${out}`)
