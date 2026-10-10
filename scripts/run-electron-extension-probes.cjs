const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const electronExecutable = require('electron')
const probeScript = join(__dirname, 'electron-extension-probe.cjs')
const caseNames = ['chromium-mv2', 'bitwarden-mv2', 'chromium-mv3', 'firefox-mv3']
const results = []

for (const name of caseNames) {
  const child = spawnSync(electronExecutable, [probeScript, name], {
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env
  })
  const stdout = child.stdout || ''
  const stderr = child.stderr || ''
  const reportLine = stdout.split(/\r?\n/).find((line) => line.startsWith('SOCKFISH_EXTENSION_PROBE_REPORT='))
  let childReport = null

  if (reportLine) {
    try {
      childReport = JSON.parse(reportLine.slice('SOCKFISH_EXTENSION_PROBE_REPORT='.length))
    } catch (error) {
      if (name === 'chromium-mv2') {
        throw new Error(`The required MV2 probe emitted malformed JSON: ${String(error)}\n${stdout}\n${stderr}`)
      }
    }
  }

  const record = {
    name,
    exitCode: child.status,
    signal: child.signal,
    timedOut: Boolean(child.error && child.error.code === 'ETIMEDOUT'),
    runnerError: child.error ? child.error.message : null,
    electronStderr: stderr.trim() || null,
    result: childReport?.cases?.[0] ?? null
  }
  results.push(record)

  if (name === 'chromium-mv2' && (child.status !== 0 || !record.result)) {
    throw new Error(`The required Electron MV2 baseline failed.\n${JSON.stringify(record, null, 2)}\n${stdout}`)
  }
}

console.log('Electron extension compatibility test results:')
console.log(JSON.stringify({
  electronVersion: require('electron/package.json').version,
  cases: results,
  interpretation: 'Only the documented MV2 baseline is a pass/fail assertion. MV3 and Firefox-shaped outcomes are captured as observations, including loader warnings or crashes.'
}, null, 2))
