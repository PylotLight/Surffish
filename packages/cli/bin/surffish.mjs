#!/usr/bin/env node
// npx @pylotlight/surffish / bunx @pylotlight/surffish / `surffish` after a global install.
import { readFileSync } from 'node:fs'
import config from '../app.config.mjs'
import { run } from '../lib/launcher.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

run(config, { packageVersion: pkg.version, manifestPath: new URL('../release.json', import.meta.url) })
  .then((code) => { process.exitCode = code })
  .catch((err) => {
    if (err?.exitCode) { process.exitCode = err.exitCode; return }
    process.stderr.write(`${config.id}: ${err?.message ?? err}\n`)
    process.exitCode = 1
  })
