import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { copyFileSync, cpSync, mkdirSync, rmSync } from 'node:fs'
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
    // Chrome Web Store extensions: popup/options bridge and the store page "Add to Surffish" hook.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/extension-host.cjs'),
      join(outputDirectory, 'extension-host.cjs')
    )
    copyFileSync(
      resolve(projectDirectory, 'src/preload/web-store-page.cjs'),
      join(outputDirectory, 'web-store-page.cjs')
    )
    // Built-in PDF editor page bridge.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/pdf-editor.cjs'),
      join(outputDirectory, 'pdf-editor.cjs')
    )
  }
}

// pdf.js data the editor loads at runtime (CJK cmaps, the 14 standard fonts, image decoders, the
// CMYK profile) is bundled locally so the editor never fetches anything but the PDF itself.
// Skipped: the scripting sandbox (quickjs; form JavaScript is not run) and no-wasm JS fallbacks.
const PDFJS_DATA = ['cmaps', 'standard_fonts', 'iccs', 'wasm']
const PDFJS_SKIPPED = /(?:quickjs|nowasm_fallback)/
const pdfjsDataPlugin = {
  name: 'surffish-pdfjs-data',
  closeBundle() {
    const source = resolve(projectDirectory, 'node_modules/pdfjs-dist')
    const target = resolve(projectDirectory, 'out/renderer/pdfjs')
    rmSync(target, { recursive: true, force: true })
    for (const folder of PDFJS_DATA) {
      cpSync(join(source, folder), join(target, folder), { recursive: true, filter: (path) => !PDFJS_SKIPPED.test(path) })
    }
    // Annotation icons pdf.js resolves through imageResourcesPath.
    cpSync(join(source, 'web/images'), join(target, 'images'), { recursive: true })
    copyFileSync(join(source, 'LICENSE'), join(target, 'LICENSE'))
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
    plugins: [react(), pdfjsDataPlugin],
    build: {
      rollupOptions: {
        input: {
          index: resolve(projectDirectory, 'src/renderer/index.html'),
          // Built-in PDF editor (pdf.js + pdf-lib), served from surffish-pdf://editor/ only.
          'pdf-editor': resolve(projectDirectory, 'src/renderer/pdf-editor.html')
        }
      },
      // Three renderer surfaces each parse this bundle at launch; ship it minified.
      minify: true,
      cssMinify: true
    }
  }
})
