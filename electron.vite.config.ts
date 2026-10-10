import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'

const projectDirectory = dirname(fileURLToPath(import.meta.url))
const bramblePreloadPlugin = {
  name: 'sockfish-bramble-commonjs-preload',
  closeBundle() {
    const outputDirectory = resolve(projectDirectory, 'out/preload')
    mkdirSync(outputDirectory, { recursive: true })
    rmSync(join(outputDirectory, 'bramble-poc.js'), { force: true })
    copyFileSync(
      resolve(projectDirectory, 'src/preload/bramble-poc.cjs'),
      join(outputDirectory, 'bramble-poc.cjs')
    )
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), bramblePreloadPlugin],
    build: {
      rollupOptions: {
        external: ['electron'],
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
