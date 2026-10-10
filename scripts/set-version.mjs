// One version everywhere (owner, 10.10.2026: «после каждого обновления пиши новую цифру версии»):
//   small update 0.5.4 → 0.5.4.1 → 0.5.4.2…, large update → 0.6.0, 0.7.0…
//   node scripts/set-version.mjs 0.5.4.1
// Writes package.json and package-lock.json, the website's APP_VERSION, Android versionName (+1 versionCode) and iOS
// (MARKETING_VERSION takes at most three numbers there, the fourth goes into the build number CURRENT_PROJECT_VERSION).
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2] ?? ''
if (!/^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs 0.5.4.1 (three or four numbers)')
  process.exit(1)
}
const edit = (file, change) => {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  const after = change(before)
  if (after === before) throw new Error(`${file}: nothing changed`)
  writeFileSync(path, after)
  console.log(`${file} → ${version}`)
}

edit('package.json', (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
edit('package-lock.json', (text) => {
  const lock = JSON.parse(text)
  lock.version = version
  if (lock.packages?.['']) lock.packages[''].version = version
  return `${JSON.stringify(lock, null, 2)}\n`
})
edit('website/src/config.ts', (text) => text.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`))
edit('android/app/build.gradle', (text) => text
  .replace(/versionName "[^"]+"/, `versionName "${version}"`)
  .replace(/versionCode (\d+)/, (_, code) => `versionCode ${Number(code) + 1}`))
const [major, minor, patch, small] = version.split('.')
edit('ios/App/App.xcodeproj/project.pbxproj', (text) => text
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${major}.${minor}.${patch};`)
  .replace(/CURRENT_PROJECT_VERSION = (\d+);/g, (_, build) => `CURRENT_PROJECT_VERSION = ${small ? Number(small) + 1 : Number(build) + 1};`))
