// Records SHA-256 of the native modules that a players' exe unpacks next to app.asar, so the app can check them before
// it restarts itself with administrator rights (electron/experimental/nativeIntegrity.ts, used by relaunchAsAdmin): a
// swapped *.node would otherwise run elevated. The manifest ships inside app.asar (dist-electron/native-integrity.json),
// which the Electron asar-integrity fuse seals, so it is a trusted reference. Keys are each file's path under `resources`
// at run time.
//
// Best-effort and never fatal: a native missing at build time is left out. @koromix/koffi-win32-* is a Windows-only
// optional dependency, absent on the Linux release host (scripts/pack-windows-native.cjs fetches it during the pack), so
// on the VPS koffi is recorded only when present; uiohook-napi ships prebuilt binaries for every platform and is always
// recorded. Runs inside `npm run build`.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const modules = join(root, 'node_modules')
const files = {}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function add(runtimeRelPath, sourcePath) {
  try {
    if (!existsSync(sourcePath)) return
    files[runtimeRelPath] = sha256(sourcePath)
  } catch (error) {
    console.warn(`native-integrity: skipped ${runtimeRelPath} (${error instanceof Error ? error.message : String(error)})`)
  }
}

// Koffi FFI native — scripts/pack-windows-native.cjs copies it to resources/koffi/<triplet>/koffi.node.
try {
  const koffi = JSON.parse(readFileSync(join(modules, 'koffi', 'package.json'), 'utf8'))
  for (const arch of ['x64', 'ia32', 'arm64']) {
    const name = `@koromix/koffi-win32-${arch}`
    if (koffi.optionalDependencies?.[name]) add(`koffi/win32_${arch}/koffi.node`, join(modules, name, `win32_${arch}`, 'koffi.node'))
  }
} catch (error) {
  console.warn(`native-integrity: koffi not inspected (${error instanceof Error ? error.message : String(error)})`)
}

// uiohook-napi prebuilt natives — asarUnpack keeps them under app.asar.unpacked at the same relative path.
try {
  const prebuilds = join(modules, 'uiohook-napi', 'prebuilds')
  if (existsSync(prebuilds)) {
    for (const platformArch of readdirSync(prebuilds)) {
      if (!platformArch.startsWith('win32')) continue
      const dir = join(prebuilds, platformArch)
      for (const entry of readdirSync(dir)) {
        if (entry.endsWith('.node')) add(`app.asar.unpacked/node_modules/uiohook-napi/prebuilds/${platformArch}/${entry}`, join(dir, entry))
      }
    }
  }
} catch (error) {
  console.warn(`native-integrity: uiohook-napi not inspected (${error instanceof Error ? error.message : String(error)})`)
}

try {
  const dist = join(root, 'dist-electron')
  mkdirSync(dist, { recursive: true })
  writeFileSync(join(dist, 'native-integrity.json'), `${JSON.stringify({ format: 1, files })}\n`)
  console.log(`Native integrity: ${Object.keys(files).length} file(s) recorded → dist-electron/native-integrity.json`)
} catch (error) {
  // Without the manifest the app simply does not run the pre-elevation check (it treats that as trustworthy): never a
  // reason to fail the build.
  console.warn(`native-integrity: no manifest written (${error instanceof Error ? error.message : String(error)})`)
}
