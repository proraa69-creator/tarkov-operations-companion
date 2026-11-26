// Records SHA-256 of the native modules that a players' exe unpacks next to app.asar, so the app can check them before
// it restarts itself with administrator rights (electron/experimental/nativeIntegrity.ts, used by relaunchAsAdmin): a
// swapped *.node would otherwise run elevated. The manifest ships inside app.asar (dist-electron/native-integrity.json),
// which the Electron asar-integrity fuse seals, so it is a trusted reference. Keys are each file's path under `resources`
// at run time.
//
// Best-effort and never fatal: anything that cannot be resolved is left out, the build goes on. uiohook-napi ships
// prebuilt binaries for every platform (always recorded). Koffi's native is a Windows-only optional dependency, absent
// on the Linux release host, so — exactly as scripts/pack-windows-native.cjs does when it packs the exe — this fetches
// that same version's tarball to hash the same bytes that will ship (x64, the released architecture). Runs inside
// `npm run build`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * The koffi.node that scripts/pack-windows-native.cjs copies to resources/koffi/<triplet>/koffi.node: the installed
 * optional dependency when present, else that exact version fetched from the registry (x64 only — the released
 * architecture). Returns { path, temp? }; temp is a directory to remove afterwards. null when it cannot be resolved.
 */
function koffiSource(name, version, triplet) {
  const direct = join(modules, name, triplet, 'koffi.node')
  if (existsSync(direct)) return { path: direct }
  if (triplet !== 'win32_x64' || !/^\d+\.\d+\.\d+$/.test(String(version || ''))) return null
  const temp = mkdtempSync(join(tmpdir(), 'raidos-native-integrity-'))
  const npmCli = process.env.npm_execpath
  const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const packArgs = ['pack', '--ignore-scripts', '--json', `${name}@${version}`]
  const output = execFileSync(command, npmCli ? [npmCli, ...packArgs] : packArgs, { cwd: temp, encoding: 'utf8', windowsHide: true, shell: !npmCli && process.platform === 'win32' })
  const [packed] = JSON.parse(output)
  execFileSync('tar', ['-xf', join(temp, packed.filename), '-C', temp], { windowsHide: true })
  return { path: join(temp, 'package', triplet, 'koffi.node'), temp }
}

try {
  const koffi = JSON.parse(readFileSync(join(modules, 'koffi', 'package.json'), 'utf8'))
  for (const arch of ['x64', 'ia32', 'arm64']) {
    const name = `@koromix/koffi-win32-${arch}`
    const version = koffi.optionalDependencies?.[name]
    if (!version) continue
    const triplet = `win32_${arch}`
    let resolved
    try {
      resolved = koffiSource(name, version, triplet)
      if (resolved) add(`koffi/${triplet}/koffi.node`, resolved.path)
    } catch (error) {
      console.warn(`native-integrity: koffi ${triplet} not recorded (${error instanceof Error ? error.message : String(error)})`)
    } finally {
      if (resolved?.temp) try { rmSync(resolved.temp, { recursive: true, force: true }) } catch { /* leftover temp */ }
    }
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
