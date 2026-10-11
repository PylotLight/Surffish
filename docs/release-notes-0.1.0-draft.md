# Surffish 0.1.0 — Security and Session Privacy (Draft)

**Status:** Release-candidate notes only. This draft has not been published, and no release tag has been created.

## Security and privacy

- Keep privileged browser-shell capabilities on their expected local app documents. Shell navigation and redirects are restricted; privileged IPC requires a registered app renderer's main frame to remain on its exact expected document.
- Run trusted app renderer surfaces with Electron sandboxing and a sandbox-compatible isolated preload.
- Remove URL fragments and common credential-like query parameters from saved tab URLs. Existing saved sessions are sanitized when Surffish starts; ordinary query parameters such as searches and filters remain available for restored tabs.
- Write local JSON state atomically with owner-only file permissions on POSIX systems. Add a Settings disclosure and a **Clear saved session** action; clearing does not close live tabs and pauses session saving until the next launch.
- Route Bramble release metadata and asset downloads through the configured browser session, so the selected SOCKS5 proxy applies to those requests too.

## Compatibility verification

- `bun run typecheck`
- `bun run test` — 101 unit tests across 16 files, using Bun's four-worker parallel runner
- `bun run build`
- `xvfb-run -a bun run test:electron-security` — disposable-profile end-to-end coverage for trusted navigation and IPC, subframe isolation, legacy-session migration/redaction, session clearing, and Bramble metadata/assets traversing a synthetic SOCKS proxy
- Electron regression smokes: Downloads, sidebar overlay and tab lifecycle, adblock, host/frame bridge, and extension compatibility

## Release preparation notes

- The current package version is `0.1.0`; the proposed release title is **Surffish 0.1.0 — Security and Session Privacy**.
- The release candidate has been built and locally verified. This repository currently has no installer-packaging or publishing script, so this candidate does not include signed platform installers.
- GitHub Actions configuration was not changed. No GitHub release, tag, or remote push is part of this draft.
