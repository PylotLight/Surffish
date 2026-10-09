# Architecture

Three processes, one bridge, one shared contract layer.

```
main (Node, Electron)  ──ipcMain.handle──┐
                                         ├─▶ preload (contextBridge → window.api)
renderer (React, browser) ──invoke───────┘
```

- `src/main/index.ts` — app lifecycle only: single-instance lock, `whenReady` wiring,
  quit handling. No business logic.
- `src/main/window.ts` — `BrowserWindow` creation, `showWindow`/`hideWindow`, vibrancy state.
- `src/main/tray.ts` — system tray + context menu. Left-click pops the menu; it never
  auto-shows the window.
- `src/main/ipc.ts` — every renderer→main call. Sections mirror the preload bridge.
- `src/preload/index.ts` — typed `window.api`. Nothing here but forwarding.
- `src/shared/config.ts` — runtime values safe to import anywhere (app name, id, geometry).
- `src/shared/types.ts` — type-only contracts (`SysInfo`, `GlassState`, `VibrancyName`).
- `src/renderer/` — React shell (`App.tsx`: sidebar + top bar) and example views in `views/`.

## Rules

1. **Renderer never imports main-process modules.** Type-only imports from `src/shared/`
   are allowed and erased at build time.
2. **New IPC tool = 3 edits:** `ipcMain.handle` in `src/main/ipc.ts`, expose in
   `src/preload/index.ts`, call via `window.api`. Shared payload types go in
   `src/shared/types.ts`. The bridge is typed end-to-end, so the renderer sees the new
   call immediately.
3. **New section = 2 edits:** add a view in `src/renderer/src/views/`, register it in the
   `TABS` array in `App.tsx`. Nav, layout, and glass styling come free.
4. **Tray items** go in the menu template in `src/main/tray.ts`; window actions reuse the
   helpers in `src/main/window.ts`.
5. **Agent tools** are just IPC tools with a visible plan around them — see the Agent view.
   Add yours via rule 2, then list them as plan steps.

## Layout model

The app shell is locked to the viewport (`.shell { height: 100vh; overflow: hidden }`).
Sidebar and top bar are fixed; only `.view` scrolls. Keep it that way — any opaque
full-window background also kills the native vibrancy (see vibrancy doc).
