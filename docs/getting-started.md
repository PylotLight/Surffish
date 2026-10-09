# Getting started

## Run the app

```bash
bun install
bun run dev
```

The combined address bar accepts web addresses and search queries. Click **SOCKS5** in the toolbar to view the optional local-proxy settings.

## Verify a change

```bash
bun run typecheck
bun run test
bun run build
bun run start
```

`bun run test` exercises omnibox routing for web URLs, local addresses, search queries, and rejected schemes. The build writes the main process, preload, and renderer into `out/`.

## Useful scripts

- `dev` — development server and Electron app with terminal cleanup on exit.
- `dev:bare` — raw `electron-vite dev`.
- `typecheck` — TypeScript check across application and scripts.
- `test` — focused address-bar routing tests.
- `build` — production build into `out/`.
- `start` — launch the built app.
- `clean` — remove `out/`.
