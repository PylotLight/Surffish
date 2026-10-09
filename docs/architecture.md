# Architecture

Sockfish has a trusted Electron main process, a small React browser-chrome renderer, and one isolated remote `WebContentsView` per open tab.

```text
React sidebar and browser chrome ── typed preload bridge ──▶ Electron main ──▶ tab WebContentsViews
                                                                     │                 │
                                                                     │                 └── shared persistent SOCKS5 session
                                                                     └── local history store
```

- `src/main/index.ts` — application startup; configures the browser proxy before creating the window.
- `src/main/window.ts` — native window lifecycle and platform chrome.
- `src/main/browser.ts` — isolated per-tab views, active-tab switching, bounds, navigation, and state events.
- `src/main/history.ts` — validated, bounded browsing history persisted in the app's user-data directory.
- `src/main/proxy.ts` — validates loopback-only SOCKS5 settings, persists them, and configures the browser session.
- `src/main/ipc.ts` — browser-only renderer-to-main IPC, guarded to the app window.
- `src/preload/index.ts` — narrow, typed browser API exposed through `contextBridge`.
- `src/shared/navigation.ts` — HTTP(S)-only address parsing and DuckDuckGo query routing.
- `src/shared/types.ts` — browser and proxy contracts shared across processes.
- `src/renderer/` — sidebar tabs/history, navigation toolbar, optional proxy settings panel, and the native web-page viewport.

## Security boundaries

1. Remote content is not loaded into the React renderer. Its `WebContentsView` uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
2. Remote views receive no preload bridge; the local renderer can call only the explicit tab, history, browser, and proxy methods.
3. Non-HTTP(S) navigations, popups, and web permission requests are blocked. SOCKS settings accept loopback hosts only.
