# Third-party visual assets

## Bramble toolbar icon

`src/renderer/src/assets/bramble-extension-icon.png` is an unchanged copy of Bramble's official dark-toolbar icon, selected from the upstream extension repository:

- Repository: [flythenimbus/bramble](https://github.com/flythenimbus/bramble)
- Upstream revision: `e334625e7fef95c1e1dfbe9b9e46097023bd21e6`
- Source path: `packages/platform-extension/public/icons/icon-32-dark.png`
- License: GNU General Public License, version 3 (GPL-3.0)

The upstream license text is included at [`licenses/GPL-3.0-Bramble-icon.txt`](licenses/GPL-3.0-Bramble-icon.txt). The icon is used as a toolbar image; the Bramble extension's behavior and shortcut remain unchanged.

## New Tab fallback photos

`src/renderer/src/assets/quick-links-backgrounds/forest-lake.webp` and `tranquil-mountain-lake.webp` are WebP copies of CC0 1.0 files from Wikimedia Commons ([Landscape-nature-forest-lake](https://commons.wikimedia.org/wiki/File:Landscape-nature-forest-lake_(24300004076).jpg), Pixel.la Free Stock Photos; [Tranquil mountain lake](https://commons.wikimedia.org/wiki/File:Tranquil_mountain_lake_(Unsplash).jpg), Andrew Spencer). CC0 needs no attribution; the New Tab shows credits anyway. Photos fetched at runtime are limited to CC0 or attribution-only CC BY files and credited on screen.

## PDF editor signature fonts

`src/renderer/src/pdf-editor/fonts/great-vibes-latin.woff2` and `allura-latin.woff2` are the unmodified Latin WOFF2 files Google Fonts serves for [Great Vibes](https://github.com/googlefonts/great-vibes) (Copyright 2015 The Great Vibes Pro Project Authors) and [Allura](https://github.com/googlefonts/allura) (Copyright 2010 The Allura Project Authors), about 55 KB together. Both are licensed under the SIL Open Font License 1.1 with no Reserved Font Name; the license texts are in [`licenses/OFL-1.1-Great-Vibes.txt`](licenses/OFL-1.1-Great-Vibes.txt) and [`licenses/OFL-1.1-Allura.txt`](licenses/OFL-1.1-Allura.txt). They are only loaded by the built-in PDF editor's signature dialog, so typed signatures have real script faces on systems without Snell Roundhand / Segoe Script and friends (those system fonts are used when installed, never bundled).

## jsQR (Bramble Scan QR fallback)

`out/vendor/jsqr.min.js` is [jsQR](https://github.com/cozmo/jsQR) 1.4.0 (Copyright Cosmo Wolfe), minified at build time from the `jsqr` dev dependency, about 130 KB (47 KB gzipped). Licensed under the Apache License 2.0; the license text is in [`licenses/Apache-2.0-jsQR.txt`](licenses/Apache-2.0-jsQR.txt). It is copied into Surffish's staged copy of Bramble as `surffish-jsqr.js` and only loaded the first time the Join a device **Scan QR** runs on a system without Chromium's `BarcodeDetector` (it is used on macOS only if `BarcodeDetector` can't read QR codes).

## Read Aloud voice model (downloaded, not bundled)

Read Aloud downloads, when it is turned on, the official [`phonon-tts`](https://www.npmjs.com/package/phonon-tts) npm package (WebAssembly runtime), the [gradium/phonon-31m-en](https://huggingface.co/gradium/phonon-31m-en) q8 model files and, when picked, voices from [gradium/phonon-voices](https://huggingface.co/gradium/phonon-voices), all Apache License 2.0, each pinned to a version or commit and checked against its hash (`src/shared/read-aloud-assets.ts`, `src/shared/read-aloud-voices.ts`). They are stored in the profile's `read-aloud` folder and never shipped with the app. See [Read Aloud](read-aloud.md).

## Maple Mono optional testing font

`src/renderer/src/assets/fonts/maple-mono/` contains the unchanged Maple Mono v7.9 normal and italic variable WOFF2 fonts, sourced from the [subframe7536/maple-font](https://github.com/subframe7536/maple-font) repository at tag `v7.9` (`woff2/var/MapleMono[wght]-VF.woff2` and `woff2/var/MapleMono-Italic[wght]-VF.woff2`). The fonts are licensed under the SIL Open Font License, Version 1.1; the full upstream license is included as [`src/renderer/src/assets/fonts/maple-mono/OFL.txt`](../src/renderer/src/assets/fonts/maple-mono/OFL.txt). These assets are optional testing fonts and are not a release change.
A copy of the Maple Mono license is also kept at `src/renderer/public/licenses/MapleMono-OFL.txt`, which Vite includes in production output as `out/renderer/licenses/MapleMono-OFL.txt` so distributed applications retain the upstream license notice.
