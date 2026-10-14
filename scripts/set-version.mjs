// One version everywhere (owner, 10.10.2026: «после каждого обновления пиши новую цифру версии»):
//   small update 0.6.0 → 0.6.0.1 → 0.6.0.2…, large update → 0.7.0, 0.8.0…
//   node scripts/set-version.mjs 0.6.0.2            (Windows app, website, API: what release/production publishes)
//   node scripts/set-version.mjs 0.6.0.2 --mobile   (also iOS, for a phone build)
// Android takes versionName / versionCode from package.json itself (android/app/build.gradle, docs/mobile.md).
//
// electron-builder only takes a semver version in package.json (it refuses «0.6.0.2»: Invalid version), so package.json
// and the lock get «0.6.0-2»; the app and the website show it as «0.6.0.2» (displayVersion in src/app/appVersion.ts and
// website/src/config.ts). Updates compare build numbers, never versions, so the form does not change which build is newer.
//
// iOS is not touched by default: the VPS publisher refuses android/ and ios/ paths in a release
// (release-policy.mjs deployPath: «Unsupported deployment path»), and 0.5.4.2–0.6.0.1 were never published because of
// that. Bump it with --mobile only for a phone build that does not go through release/production.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = process.argv[2] ?? ''
const mobile = process.argv.includes('--mobile')
if (!/^[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs 0.6.0.2 [--mobile] (three or four numbers)')
  process.exit(1)
}
const [major, minor, patch, small] = version.split('.')
const packageVersion = small ? `${major}.${minor}.${patch}-${small}` : version
const edit = (file, change) => {
  const path = join(root, file)
  const before = readFileSync(path, 'utf8')
  const after = change(before)
  if (after === before) throw new Error(`${file}: nothing changed`)
  writeFileSync(path, after)
  console.log(`${file} → ${file.endsWith('.json') ? packageVersion : version}`)
}

edit('package.json', (text) => text.replace(/("version":\s*")[^"]+(")/, `$1${packageVersion}$2`))
edit('package-lock.json', (text) => {
  const lock = JSON.parse(text)
  lock.version = packageVersion
  if (lock.packages?.['']) lock.packages[''].version = packageVersion
  return `${JSON.stringify(lock, null, 2)}\n`
})
edit('website/src/config.ts', (text) => text.replace(/APP_VERSION = '[^']+'/, `APP_VERSION = '${version}'`))
if (mobile) {
  // MARKETING_VERSION takes at most three numbers, the fourth goes into the build number CURRENT_PROJECT_VERSION.
  edit('ios/App/App.xcodeproj/project.pbxproj', (text) => text
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${major}.${minor}.${patch};`)
    .replace(/CURRENT_PROJECT_VERSION = (\d+);/g, (_, build) => `CURRENT_PROJECT_VERSION = ${small ? Number(small) + 1 : Number(build) + 1};`))
}
