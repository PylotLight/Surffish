/**
 * electron-builder's dmg.format schema doesn't accept ULMO (lzma), so it builds ULFO and this
 * re-packs the dmg with hdiutil. ULMO is ~98mb vs ~126mb ULFO on electron 44 arm64. macOS only.
 */
import { existsSync, renameSync, rmSync } from 'node:fs'
const pkg = await Bun.file(new URL('../package.json', import.meta.url)).json()

if (process.platform !== 'darwin') {
  console.log('compress-dmg: not macOS, skipping')
  process.exit(0)
}

const dmg = `release/${pkg.build.productName}-${pkg.version}-mac-arm64.dmg`
if (!existsSync(dmg)) {
  console.log(`compress-dmg: ${dmg} not found, skipping`)
  process.exit(0)
}

const tmp = dmg.replace(/\.dmg$/, '.ulmo.dmg')
rmSync(tmp, { force: true })
const r = Bun.spawnSync(['hdiutil', 'convert', dmg, '-format', 'ULMO', '-o', tmp], {
  stdout: 'inherit',
  stderr: 'inherit'
})
if (r.exitCode !== 0) process.exit(r.exitCode ?? 1)
renameSync(tmp, dmg)
console.log(`compress-dmg: ${dmg} is now ULMO (${(Bun.file(dmg).size / 1e6).toFixed(1)} MB)`)
