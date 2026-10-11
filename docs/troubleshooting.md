# Troubleshooting

## The proxy is on but pages do not load

Make sure the SSH dynamic-forwarding command is still running on the same computer, and that its `-D` port matches Sockfish's **SOCKS5** settings. **Test port** checks only whether a TCP service is listening; it does not test the SOCKS handshake or SSH destination. Turn **Use proxy** off to test a direct connection.

## Address bar does not open the expected page

Press Enter after typing. Domain-like hosts are opened as URLs; ordinary text is sent to the selected search engine. Only HTTP(S) schemes are accepted. `localhost` and loopback IP addresses use HTTP automatically.

## Ads still appear or a page request fails

Network filtering blocks matching subresource requests, not cosmetic page elements. Sockfish allows `googlevideo.com` delivery hosts so YouTube playback is not interrupted; ads delivered through those shared hosts may remain. Use the **Network** inspector to review requests and Electron's native Web inspector for Chromium page/runtime investigation. The separate Diagnostics page has been removed; the filtering engine refreshes its lists at startup when the cache is stale.

## A download is interrupted, canceled, or missing

Open **Downloads** from the toolbar. A resumable interrupted item offers **Resume**; an item that cannot be resumed after a browser restart remains in history as failed and must be downloaded again from its source. **Open** acts only after you click it, and **Show in folder** reveals an available file. **Remove** clears history metadata only and never deletes the saved file. If a completed file has been moved or deleted outside Sockfish, its history entry can remain but Open/Show in folder are unavailable.

## A pinned-site icon is blank

Sockfish requests the site's own `/favicon.ico` directly without a referrer. Some sites do not provide that conventional favicon path; in that case the icon intentionally falls back to the site's initial. Pinning and navigation still work.

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
