# Sidebar overlay follow-up: native layering result

**Status: not restored.** The app has not been changed to claim or simulate a live-page overlay. A bounds-only change would cover the sidebar and break the existing shell controls, so this follow-up records the production-app measurement and a safe implementation path instead.

## Production measurement

The production Electron build was run in a disposable profile against a synthetic HTTP page served on loopback. No user profile, browsing data, or external website was used. The app window was set to 1280 × 800 pixels; the measured renderer viewport was 1279 × 751 at `(0, 48)`.

| State | Native `WebContentsView` bounds (x, y, width, height) | Measured outcome |
|---|---:|---|
| Site open, sidebar hidden | `(14, 48, 1265, 751)` | The 14-pixel reveal strip is kept clear, so the page is 14 pixels narrower than the viewport. |
| Site open, 320-pixel sidebar visible | `(320, 48, 959, 751)` | The page begins beside the sidebar; the glass panel is not over live page pixels. |
| Deliberate full-viewport trial with sidebar visible | `(0, 48, 1279, 751)` | The native page layer paints over the sidebar and obscures it. |
| App-rendered New Tab | No native site view child | The scenic background and sidebar are both in the shell renderer, so New Tab can show the glass over its image. |

`BrowserWindow.contentView.children` contained one native `WebContentsView` for the live site (index 0). Electron's `View.addChildView` controls the order of explicit native child views; it does not expose the BrowserWindow's own renderer as a sibling that can be brought above the site view. The screenshots below show the New Tab overlay, current side-by-side layout, and full-width trial where the native page covers the sidebar.

### Full-window production screenshots

These are 1280 × 800 captures from the real Linux Electron app, not mockups. The synthetic site uses a large red heading and green diagonal pattern so coverage is obvious.

- **New Tab:** app-rendered scenic image with the glass sidebar pinned open; the background remains visible because no separate site view is attached. ![Production Electron New Tab screenshot](screenshots/sidebar-overlay-new-tab.png)
- **Current live-site bounds:** sidebar remains usable at the left, while the site starts at its right edge. ![Production Electron synthetic-site screenshot with current bounds](screenshots/sidebar-overlay-site-current-bounds.png)
- **Full-width trial:** page pixels cover the entire sidebar; a CSS z-index change in the shell cannot put that DOM panel above this native view. ![Production Electron full-width trial showing native page occluding the sidebar](screenshots/sidebar-overlay-site-full-width-trial.png)

## Why a bounds-only fix is unsafe

The existing sidebar, tabs, pin controls, reveal behavior, and glass are rendered in `BrowserWindow.webContents`. The active website is a separate native `WebContentsView` added to the window's content view. Extending that native view to the full viewport makes the website the visible/clickable surface across the sidebar; it does not become a translucent background layer. Conversely, keeping the native view below the shell would require handling input explicitly so page clicks, keyboard input, wheel/scroll, context menus, and focus still reach the active site. A full-width page also covers the current 14-pixel hover-reveal strip unless that interaction is moved or forwarded.

## Concrete implementation option

For a real overlay, make the native layer order explicit rather than changing CSS or only widening bounds:

1. Host the app with an explicit `BaseWindow`/native view tree, with the active site `WebContentsView` at the bottom and a local, topmost chrome/overlay view above it.
2. Keep the overlay view's hit-test surface limited to the visible toolbar/sidebar controls. Use an IPC bridge for tabs, pins, history, pinning, and panel navigation; keep the existing settings, Downloads, Bramble, and Network Inspector flows in the shell as appropriate.
3. Make the hidden reveal edge forward pointer input to the active page (or use an equivalent native hit-test mechanism), and route keyboard focus/shortcuts deliberately. Do not allow a transparent full-window shell view to silently swallow website clicks or scrolling.
4. Add production Electron checks for page click, keyboard, wheel/scroll, sidebar hover/pin, tabs, downloads, Bramble, and Network Inspector before switching the default.

This is a UI-layer and input-routing change, not a safe one-line CSS or `setBounds` patch. The current follow-up deliberately leaves runtime behavior unchanged.

## Reproduction

After building, run the production Electron probe under Xvfb:

```bash
xvfb-run -a bun run test:electron-sidebar-overlay
```

The smoke test uses a disposable temporary profile and a loopback-only synthetic site. To capture new full-window screenshots instead of relying on the committed evidence, set `SOCKFISH_SCREENSHOT_DIR` and use a 1280 × 800 Xvfb display; `ffmpeg` is only needed when that optional capture variable is set.
