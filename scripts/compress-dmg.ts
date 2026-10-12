/**
 * Builds the dmg straight from the app electron-builder already made for the zip
 * (release/mac-arm64/Surffish.app), with hdiutil and ULMO (lzma) compression.
 * electron-builder's own dmg target gave "not supported on this Mac" and wouldn't compress,
 * and its schema doesn't accept ULMO anyway. macOS only.
 */
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

if (process.platform !== 'darwin') {
  console.log('compress-dmg: not macOS, skipping')
  process.exit(0)
}

const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json()
const name: string = pkg.build.productName
const app = `release/mac-arm64/${name}.app`
const dmg = `release/${name}-${pkg.version}-mac-arm64.dmg`

if (!existsSync(app)) {
  console.error(`compress-dmg: ${app} not found, run electron-builder first`)
  process.exit(1)
}

function run(cmd: string[]) {
  const r = Bun.spawnSync(cmd, { stdout: 'inherit', stderr: 'inherit' })
  if (r.exitCode !== 0) {
    console.error(`compress-dmg: ${cmd.join(' ')} failed`)
    process.exit(r.exitCode ?? 1)
  }
}

const stage = mkdtempSync(join(tmpdir(), 'surffish-dmg-'))
try {
  // ditto keeps the code signature, symlinks inside the frameworks and xattrs intact
  run(['ditto', app, join(stage, `${name}.app`)])
  symlinkSync('/Applications', join(stage, 'Applications'))
  rmSync(dmg, { force: true })
  run(['hdiutil', 'create', '-volname', name, '-srcfolder', stage, '-fs', 'HFS+', '-format', 'ULMO', '-ov', dmg])
  run(['hdiutil', 'verify', dmg])
} finally {
  rmSync(stage, { recursive: true, force: true })
}

console.log(`compress-dmg: ${dmg} (${(Bun.file(dmg).size / 1e6).toFixed(1)} MB, ULMO)`)
