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
