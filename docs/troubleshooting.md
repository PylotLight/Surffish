# Troubleshooting

## The proxy is on but pages do not load

Make sure the SSH dynamic-forwarding command is still running on the same computer, and that its `-D` port matches Sockfish's **SOCKS5** settings. **Test port** checks only whether a TCP service is listening; it does not test the SOCKS handshake or SSH destination. Turn **Use proxy** off to test a direct connection.

## Address bar does not open the expected page

Press Enter after typing. Domain-like hosts are opened as URLs; ordinary text is sent to DuckDuckGo. Only HTTP(S) schemes are accepted. `localhost` and loopback IP addresses use HTTP automatically.

## Garbage characters after exiting development (`^[[?62;22c`, `^[[9;1R`, etc.)

Electron probes terminal capabilities at startup. `bun run dev` runs through `scripts/dev.ts`, which drains leftover terminal reply bytes on shutdown. If the app is killed from another terminal, run `reset` in the affected terminal. `bun run dev:bare` skips the cleanup wrapper.

## `bun run dev` fails with `Error: spawn ENOEXEC`

The `electron` npm package ships without its binary, and Bun does not run install scripts automatically. Recover with:

```bash
rm -rf node_modules/electron/dist
bun install
```

## Preload changes do not take effect

Restart development after changing `src/preload/index.ts`. The preload bridge is part of the Electron build, and its methods must match the IPC handlers in `src/main/ipc.ts`.
