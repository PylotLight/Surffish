# UI motion, swipe intent and view flashes

## Sidebar open/close: one timeline

Over live pages the sidebar is its own `WebContentsView`. With the native blur (macOS default),
the view's own background *is* the dark blurred card (`View.setBackgroundColor` +
`setBackgroundBlur`). A CSS transform inside the view can only move its contents, so the tint/blur
used to appear at full strength at once while the panel slid in 260 ms later, and closing cut both
instantly.

Now `src/main/sidebar-motion.ts` moves the view itself along one eased timeline
(`src/shared/sidebar-motion.ts`: 200 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`, same for open and
close):

- The view keeps its card size and only its x changes, so the blur/tint and the card slide as one
  piece and the sidebar renderer never gets a resize on reveal (it used to flip 0 → 320 px wide).
- The native tint alpha and blur radius ramp with the same progress (`sidebar-backdrop.ts`), never
  quite to 0 (a layered view with a fully transparent background stops drawing).
- The view is hidden only once a close has landed, so its last painted frame is never a half
  state that flashes on the next reveal. Reversing mid-way continues from where it is.
- The in-page sidebar (New Tab, full panels) uses the same duration/curve via
  `--sidebar-motion-duration` / `--sidebar-motion-easing`.
- macOS "Reduce motion" (`systemPreferences.getAnimationSettings()`) snaps; CSS honours
  `prefers-reduced-motion`.

Knobs: `SURFFISH_SIDEBAR_MOTION=stepped` (default, main steps the view ~120 Hz) | `native`
(Electron's compositor-animated `setBounds`; experimental, the web contents may not follow the
layer animation on macOS) | `off`.

## Back/forward swipe intent

`src/shared/swipe-intent.ts` decides whether a two-finger movement is a history swipe. The native
module (`src/native/macos/mac-trackpad-swipe.mm`) now sends the running totals (`dx`, `dy`,
`elapsedMs` since the fingers went down) on each event once its 3 pt / 1.35x pre-filter passes,
and JS answers start / keep watching (`-1`) / refuse.

Defaults: ≥10 pt sideways, ≥2x more sideways than vertical, ≥0.08 pt/ms average sideways speed,
refuse after 14 pt vertical or 450 ms without qualifying; a committed swipe must have reached 12%
progress. Tune on a real trackpad with e.g.
`SURFFISH_SWIPE_INTENT="minDistance=8,minRatio=1.8,minVelocity=0.06"` and watch decisions with
`SURFFISH_SWIPE_DEBUG=1`.

## View flashes ("content behind flashes briefly")

Fixed:

- **Tab switch / leaving New Tab or a panel**: off-screen page views were shrunk to 0x0, then
  attached and resized back on screen, so the page re-laid out from zero width and the first
  frames were stale or empty. Off-screen views now keep their last size and bounds are applied
  *before* attaching (`src/shared/page-view-bounds.ts`). New tab views start at the page-area size
  and hidden, so `getVisible()` means "on screen" for every page view.
- **Sidebar reveal**: no more 0 → full width resize; hidden only after the close lands (above).

Hypotheses not confirmed (no repro on Linux/Xvfb; need a Mac):

- **Content surface stale frame**: the full-window content renderer is `setVisible(false)` while a
  live page shows and is shown again when Settings/Downloads/Bookmarks open. Chromium doesn't
  paint hidden views, so the first frame after showing can be the *previous* content (e.g. an old
  New Tab) until the renderer paints the new mode. Options: keep it painting while hidden
  (`webContents.incrementCapturerCount(undefined, true)`, costs idle GPU), or show it one frame
  after the renderer acks the new mode.
- **Toolbar popovers/palette**: the toolbar view grows to fit a popover only after the renderer
  reports its height over IPC, so a popover can render clipped for a frame and then the resized
  view repaints (owned by the toolbar-popover work, not changed here).
- **Link-status pill**: its view is resized per URL and shown immediately, so the previous text can
  flash for a frame.
- **Toolbar view** flips visible when going New Tab → site, showing whatever it painted last.
