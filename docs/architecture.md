# Architecture

Sockfish has a trusted Electron main process, a small React browser-chrome renderer, and one isolated remote `WebContentsView` per open tab.

```text
React sidebar and browser chrome ── typed preload bridge ──▶ Electron main ──▶ tab WebContentsViews
                                                                     │                 │
                                                                     │                 └── shared persistent SOCKS5 session
                                                                     ├── local profile and settings
                                                                     └── local history store
```

- `src/main/index.ts` — application startup; restores protected session cookies and configures the browser proxy before creating tabs.
- `src/main/window.ts` — native window lifecycle and platform chrome.
- `src/main/browser.ts` — isolated per-tab views, active-tab switching, bounds, navigation, and restoration of the last open tabs.
- `src/main/browser-persistence.ts` — app-data persistence for open tab URLs, active tab, and browser preferences.
- `src/main/session-cookies.ts` — encrypted snapshot/restore of session-only cookies using Electron safeStorage when OS-backed encryption is available.
- `src/main/history.ts` — validated, bounded browsing history persisted in the app's user-data directory.
- `src/main/proxy.ts` — validates loopback-only SOCKS5 settings, persists them, and configures the browser session.
- `src/main/ipc.ts` — browser-only renderer-to-main IPC, guarded to the app window.
- `src/preload/index.ts` — narrow, typed browser API exposed through `contextBridge`.
- `src/shared/navigation.ts` — HTTP(S)-only address parsing and selected-search-engine routing.
- `src/shared/types.ts` — browser and proxy contracts shared across processes.
- `src/renderer/` — sidebar tabs/history/settings/quit navigation, a compact address toolbar, and the native web-page viewport.

## Security boundaries

1. Remote content is not loaded into the React renderer. Its `WebContentsView` uses `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
2. Remote views receive no preload bridge; the local renderer can call only the explicit tab, history, browser, and proxy methods.
3. Non-HTTP(S) navigations, popups, and web permission requests are blocked. SOCKS settings accept loopback hosts only.
