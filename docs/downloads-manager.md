# Downloads manager

## User interface

The Downloads toolbar button opens an anchored, keyboard-accessible popup with up to six recent transfers and a **Show all** action. The full Downloads page lists local history. Both views show each filename, sanitized source host, date, received/total size, status and progress where known. The implementation follows Electron's official [`DownloadItem` API](https://www.electronjs.org/docs/latest/api/download-item) for transfer events and supported controls.

- Active transfers can be paused and resumed when Electron supports it, or canceled. Interrupted transfers offer Resume only while the live Electron `DownloadItem` reports that it can resume.
- Completed rows offer **Open** and **Show in folder** only when the saved file is still available. Opening is always an explicit user action; Sockfish never automatically launches a downloaded file.
- Failed, canceled and completed entries can be removed from history. Removing a row never deletes its file.
- Empty and loading states appear while history is being read. Store-read errors offer Retry; interrupted/failed items include a plain-language status.
- Tab/Shift+Tab operate the native buttons, focus indicators are visible, labels identify file actions, and Escape closes the popup.

## Stored data and privacy

`src/main/downloads.ts` listens for `will-download` on the browser's existing persistent Electron session. It persists only file metadata needed for history: filename, source **host** (not the complete URL), start/end times, byte counts, state, and a private local save path used for Open/Reveal. The renderer receives no local path or full source URL. No file contents or credentials are copied into download history or logged. The metadata file is in the app's user-data directory with owner-only permissions where supported.

Electron `DownloadItem` objects exist only during the current app session. When Sockfish restarts, any transfer that was still progressing, paused or interrupted is recorded as failed with a message that it cannot be resumed from the old process. Completed history persists across restarts. If the file is moved/deleted externally, its history remains but file actions become unavailable.

## Tests and screenshots

`src/shared/downloads.test.ts` uses synthetic hosts, credential-bearing test URLs, path-like filenames, unknown lengths and out-of-range progress to validate safe display formatting. `scripts/electron-download-manager-smoke.cjs` uses loopback-only synthetic attachments in actual Electron to verify pause, resume, completion, cancellation, empty-state keyboard dismissal, path privacy, persisted metadata and that removing history leaves the file intact. CI runs this same runtime smoke on headless Linux. To run it locally:

```bash
xvfb-run -a bun run test:electron-downloads
```

The UI guide contains real app-window captures with synthetic history: [Downloads popup](screenshots/downloads-popover.png) and [full Downloads page](screenshots/downloads-page.png).
