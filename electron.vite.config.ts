import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const bramblePreloadPlugin = {
  name: 'surffish-bramble-commonjs-preload',
  closeBundle() {
    const outputDirectory = resolve(projectDirectory, 'out/preload')
    mkdirSync(outputDirectory, { recursive: true })
    rmSync(join(outputDirectory, 'index.js'), { force: true })
    rmSync(join(outputDirectory, 'bramble-poc.js'), { force: true })
    copyFileSync(
      resolve(projectDirectory, 'src/preload/bramble-poc.cjs'),
      join(outputDirectory, 'bramble-poc.cjs')
    )
    // Sandboxed ad-filter frame preload (plain CommonJS, registered on the browser session).
    copyFileSync(
      resolve(projectDirectory, 'src/preload/adblock-frame.cjs'),
      join(outputDirectory, 'adblock-frame.cjs')
    )
    copyFileSync(
      resolve(projectDirectory, 'src/preload/mac-trackpad-swipe.cjs'),
      join(outputDirectory, 'mac-trackpad-swipe.cjs')
    )
    copyFileSync(
      resolve(projectDirectory, 'src/preload/tab-overview.cjs'),
      join(outputDirectory, 'tab-overview.cjs')
    )
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // Custom inputs drop electron-vite's implicit externals; keep runtime
        // deps as real imports exactly like the single-entry build.
        external: ['electron', /^@ghostery\//, 'tldts-experimental'],
        input: {
          index: resolve(projectDirectory, 'src/main/index.ts'),
          // Standalone entry so Electron harnesses reuse the production engine wiring.
          'adblock-engine': resolve(projectDirectory, 'src/main/adblock-engine.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bramblePreloadPlugin],
    build: {
      rollupOptions: {
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
        input: {
          index: 'src/preload/index.ts'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()]
  }
})
