# Troubleshooting

## The proxy is on but pages do not load

If **SSH host alias** is set in **Settings → Connection → SOCKS5 proxy**, Surffish starts the tunnel and shares `127.0.0.1:1088` between the browser and other local apps. The SSH-side listener port is selected automatically. Check that the alias exists in `~/.ssh/config` (or use `user@host`) and that its host key has been accepted.

If you manage the SSH tunnel yourself, start a local SOCKS5 endpoint such as:

```bash
ssh -N -D 127.0.0.1:1080 user@your-ssh-host
```

Make sure the SSH dynamic-forwarding command is still running on the same computer, then enter its host and port in **SOCKS5 proxy** settings with the SSH alias left blank. **Test port** checks only whether a TCP service is listening; it does not test the SOCKS handshake or SSH destination. Turn the **SOCKS5 proxy** switch off to test a direct connection.

## Address bar does not open the expected page

Press Enter after typing. Domain-like hosts are opened as URLs; ordinary text is sent to the selected search engine. Only HTTP(S) schemes are accepted. `localhost` and loopback IP addresses use HTTP automatically.

## Ads still appear or a page request fails

Filtering blocks matching requests and applies uBO cosmetic and scriptlet rules; the per-site switch turns it off for one site. Surffish allows `googlevideo.com` delivery hosts so YouTube playback is not interrupted; ads delivered through those shared hosts may remain. Use the **Network** inspector to review requests and Electron's native Web inspector for Chromium page/runtime investigation. The filtering engine refreshes its lists at startup when the cache is stale, then every 8 hours.

## A download is interrupted, canceled, or missing

Open **Downloads** from the toolbar. A resumable interrupted item offers **Resume**; an item that cannot be resumed after a browser restart remains in history as failed and must be downloaded again from its source. **Open** acts only after you click it, and **Show in folder** reveals an available file. **Remove** clears history metadata only and never deletes the saved file. If a completed file has been moved or deleted outside Surffish, its history entry can remain but Open/Show in folder are unavailable.

## A pinned-site icon is blank

Surffish first uses the site's declared favicon as reported by Chromium, then tries the site's own `/favicon.ico` without a referrer. Some sites use a different icon URL or provide no loadable icon; in that case the icon falls back to the site's initial. Pinning and navigation still work.

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
