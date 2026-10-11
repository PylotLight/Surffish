const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const { createRequire } = require('node:module')

const repoRoot = join(__dirname, '..')
const requireFromProject = createRequire(join(repoRoot, 'package.json'))
const viteCli = join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const electronBinary = requireFromProject('electron')
const probeEntry = join(repoRoot, 'out', 'host-probe', 'probe.mjs')

function run(label, executable, args, env) {
  console.error(`[host-bridge-probe] ${label}`)
  const result = spawnSync(executable, args, { cwd: repoRoot, env, stdio: 'inherit' })
  if (result.error) {
    console.error(`[host-bridge-probe] ${label} failed: ${result.error.message}`)
    process.exit(1)
  }
  if (result.signal) {
    console.error(`[host-bridge-probe] ${label} terminated by ${result.signal}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const buildEnvironment = { ...process.env }
run('build isolated Electron entry', process.execPath, [viteCli, 'build', '--config', 'electron-host-probe.vite.config.ts'], buildEnvironment)

const probeEnvironment = {
  ...process.env,
  SURFFISH_EXPERIMENTAL_EXTENSION_HOST_BRIDGE: '1'
}
run('run loopback-only disposable profile', electronBinary, [probeEntry], probeEnvironment)
