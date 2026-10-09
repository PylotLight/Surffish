# Getting started

Template repo: create your app with **Use this template** on GitHub (or clone and
re-point the remote). Everything below uses Bun only.

## Run it

```bash
bun install   # also guarantees the Electron binary via postinstall
bun run dev   # dev server + app (wrapped: cleans terminal state on exit)
```

## Verify it

```bash
bun run typecheck
bun run build     # → out/{main,preload,renderer}/
bun run start     # launch the built app
```

## Make it yours

When starting a real app from this template, touch these and nothing else:

| # | File | Change |
|---|------|--------|
| 1 | `package.json` | `name`, `version`, `description` |
| 2 | `src/shared/config.ts` | `APP_NAME`, `APP_TAGLINE`, `APP_ID`, window size |
| 3 | `src/renderer/index.html` | `<title>` |
| 4 | `assets/` | Replace tray icons, or regenerate: `bun run assets` (`trayTemplate.png` for macOS, `tray.png` elsewhere) |
| 5 | `LICENSE` | Copyright holder |
| 6 | `.github/workflows/ci.yml` | Keep as-is (install → typecheck → build) |

## Scripts

| Script | What it does |
|--------|--------------|
| `dev` | `bun scripts/dev.ts` — dev server + app with terminal cleanup on exit |
| `dev:bare` | Raw `electron-vite dev` (no wrapper) |
| `build` | Production build into `out/` |
| `start` | Launch the built app (`electron ./out/main/index.js`) |
| `preview` | Serve the built renderer only |
| `clean` | Remove `out/` |
| `typecheck` | `tsc --noEmit` over `src/`, `scripts/`, and config |
| `assets` | Regenerate tray PNGs, zero dependencies |
| `postinstall` | Runs automatically: downloads the Electron binary Bun skips |
