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
    // Glance header/backdrop page bridge.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/glance.cjs'),
      join(outputDirectory, 'glance.cjs')
    )
    copyFileSync(
      resolve(projectDirectory, 'src/preload/screenshot.cjs'),
      join(outputDirectory, 'screenshot.cjs')
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
    // Hidden per-extension relay page (webNavigation events, declarativeNetRequest state).
    copyFileSync(
      resolve(projectDirectory, 'src/preload/extension-bridge.cjs'),
      join(outputDirectory, 'extension-bridge.cjs')
    )
    // Surffish's quick unlock panel over Bramble's popup.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/bramble-quick-unlock.cjs'),
      join(outputDirectory, 'bramble-quick-unlock.cjs')
    )
    // Built-in PDF editor page bridge.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/pdf-editor.cjs'),
      join(outputDirectory, 'pdf-editor.cjs')
    )
    // Built-in Reader view page bridge.
    copyFileSync(
      resolve(projectDirectory, 'src/preload/reader.cjs'),
      join(outputDirectory, 'reader.cjs')
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
        // Shared chunks sit next to app.js, not under chunks/: main resolves ../renderer, ../preload
        // and ../native from import.meta.url, and the boot entry makes Rolldown split app code into one.
        output: { format: 'es', chunkFileNames: '[name]-[hash].js' },
        input: {
          // index.js is a tiny boot entry that enables Node's compile cache, then imports app.js
          // (src/main/index.ts). app.js stays in out/main/: main resolves ../renderer etc. from import.meta.url.
          index: resolve(projectDirectory, 'src/main/boot.ts'),
          app: resolve(projectDirectory, 'src/main/index.ts'),
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
          'pdf-editor': resolve(projectDirectory, 'src/renderer/pdf-editor.html'),
          // Reader view (Readability article + DOMPurify), served from surffish-reader://reader/ only.
          reader: resolve(projectDirectory, 'src/renderer/reader.html')
        }
      },
      // Three renderer surfaces each parse this bundle at launch; ship it minified.
      minify: true,
      cssMinify: true,
      // The only chunk past Vite's 500 kB default is the PDF editor entry (pdf.js + pdf-lib, ~1 MB),
      // which loads on its own page and never at startup (the perf check tracks the startup JS).
      // Warn again if anything grows past that.
      chunkSizeWarningLimit: 1200
    }
  }
})
