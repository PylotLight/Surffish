# Troubleshooting

## Garbage characters after exiting dev (`^[[?62;22c`, `^[[9;1R`, `^[[11;rgb:...`)

On startup Electron probes terminal capabilities (device attributes, cursor position,
background color). The terminal answers by injecting reply bytes into stdin; they sit in
the pty queue, and after `^C` your shell reads them as keystrokes. This affects many
Electron apps, not just this one.

`bun run dev` runs through `scripts/dev.ts`, which owns shutdown: on child exit it drains
leftover stdin bytes (in raw mode, so they can't trigger anything) and restores the
cursor before returning your prompt. If you kill the process from *another* terminal the
wrapper never runs — use `reset`. `bun run dev:bare` skips the wrapper for raw
`electron-vite dev` behavior.

## `bun run dev` fails with `Error: spawn ENOEXEC`

The `electron` npm package ships **without** its binary; an install script downloads it,
and Bun does not run that script. Recovery (bun only):

```bash
rm -rf node_modules/electron/dist
bun install   # root postinstall → checksum-verified install-electron
```

Verify before running dev: `cat node_modules/electron/dist/version` matches `package.json`,
and on macOS `file node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`
reports a Mach-O executable.

## Window is opaque, no blur on macOS

Checklist: `transparent: true` + `backgroundColor: '#00000000'` in `window.ts`, a vibrancy
material set, and — most commonly — no opaque full-window CSS background. See
`docs/vibrancy-and-tray.md`.

## Preload changes not taking effect

`window.api` is baked at build time. `bun run dev` rebuilds main/preload on change and
restarts Electron automatically; if you edited the bridge and the renderer disagrees,
restart dev. Type errors across the bridge mean `src/main/ipc.ts` and
`src/preload/index.ts` disagree — they must mirror each other.
