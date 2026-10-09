# Vibrancy & tray behavior (macOS)

## Vibrancy

Full-window translucency needs all three, and they live in two places:

1. **Main** (`src/main/window.ts`, darwin only): `transparent: true`,
   `vibrancy: 'fullscreen-ui'`, `backgroundColor: '#00000000'`,
   `titleBarStyle: 'hiddenInset'` with inset traffic lights.
2. **Renderer** (`src/renderer/src/index.css`): the shell background must stay
   **translucent**. Any opaque full-window layer covers the native
   `NSVisualEffectView` blur and vibrancy silently disappears. This was the actual
   bug the first time around — the window flags were right, the CSS hid them.

Other platforms get the same look via CSS `backdrop-filter` (no native call needed).

The Glass tab switches materials live through `win.setVibrancy()` (`glass:set` IPC),
so you can compare `fullscreen-ui`, `sidebar`, `hud`, etc. against a bright wallpaper.
`VibrancyName` is derived from Electron's own types and can't drift.

## Tray

- Left-click pops the context menu (`tray.popUpContextMenu()`). Showing the window
  happens only via the **Show window** menu item — never automatically.
- Icons: `assets/trayTemplate.png` (macOS, auto dark/light) and `assets/tray.png`
  (Windows/Linux). Regenerate with `bun run assets` or drop in your own PNGs.

## Hiding semantics (macOS)

| Action | API | Effect |
|--------|-----|--------|
| Hide window | `win.hide()` | Window gone, dock icon stays |
| Hide app | `app.hide()` | ⌘H behavior — app deactivates |
| Tray-only mode | `app.dock.hide()` | Dock icon removed entirely |

Restoring always calls `app.show()` first (see `showWindow()`), so the window can't get
stuck hidden after `app.hide()` / `dock.hide()`. These are dev/prod identical — no
dev-mode limitation.
