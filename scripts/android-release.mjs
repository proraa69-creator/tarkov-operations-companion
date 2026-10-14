// The files the site serves for the Android app's in-app update (src/mobile/androidUpdate.ts, docs/mobile.md
// «Обновление Android-версии»):
//   node scripts/android-release.mjs android/app/build/outputs/apk/release/app-release.apk <out-dir>
// writes <out-dir>/raid-os-<version>.apk and <out-dir>/version.json { versionCode, versionName, url, sha256, size }.
// Both go to /download/android/ on the server: the APK first, version.json last (the app reads version.json and then
// downloads the APK it names). Nothing is uploaded by this script.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RELEASE_BASE = 'https://raidos.app/download/android/'

/** The same numbers as android/app/build.gradle: «0.6.0-29» → { name: '0.6.0.29', code: 600029 }. */
export function androidVersion(packageVersion) {
  const numbers = String(packageVersion).replace('-', '.').split('.').map((part) => {
    if (!/^\d+$/.test(part)) throw new Error(`package.json version ${packageVersion}: numbers only`)
    return Number(part)
  })
  if (numbers.length < 3 || numbers.length > 4) throw new Error(`package.json version ${packageVersion}: three or four numbers expected`)
  const [major, minor, patch, small = 0] = numbers
  if (major > 209 || minor > 99 || patch > 99 || small > 999) throw new Error(`package.json version ${packageVersion} does not fit versionCode`)
  return { name: numbers.join('.'), code: major * 10_000_000 + minor * 100_000 + patch * 1_000 + small }
}

export async function writeAndroidRelease(apkPath, outDir, packageVersion) {
  const version = androidVersion(packageVersion)
  const apk = await readFile(apkPath)
  if (apk.subarray(0, 2).toString('latin1') !== 'PK') throw new Error(`${apkPath} is not an APK (zip)`)
  const file = `raid-os-${version.name}.apk`
  await mkdir(outDir, { recursive: true })
  await copyFile(apkPath, join(outDir, file))
  const release = {
    versionCode: version.code,
    versionName: version.name,
    url: `${RELEASE_BASE}${file}`,
    sha256: createHash('sha256').update(apk).digest('hex'),
    size: (await stat(apkPath)).size,
  }
  // Written aside and renamed: a half-written version.json is never seen.
  const target = join(outDir, 'version.json')
  await writeFile(`${target}.tmp`, `${JSON.stringify(release, null, 2)}\n`)
  await rename(`${target}.tmp`, target)
  return release
}

if (process.argv[1] && basename(process.argv[1]) === 'android-release.mjs') {
  const [apkPath, outDir] = process.argv.slice(2)
  if (!apkPath || !outDir) {
    console.error('Usage: node scripts/android-release.mjs <app-release.apk> <out-dir>')
    process.exit(1)
  }
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const release = await writeAndroidRelease(apkPath, outDir, version)
  console.log(`${join(outDir, basename(release.url))}\n${join(outDir, 'version.json')}: ${release.versionName} (${release.versionCode}), ${release.size} bytes, sha256 ${release.sha256}`)
}
