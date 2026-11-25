# Native WebKit frame and UI work

Target branch: `poc/native-webkit-app`

## Visual reference

The supplied Surffish screenshots establish two useful reference points:

- The existing Surffish application uses a compact browser toolbar, a distinct left navigation area, and a rounded page surface.
- The native WebKit PoC reference uses a roughly 320 px sidebar, a 50 px toolbar, and an inset page surface with consistent 8 px spacing.

The native PoC should keep its AppKit/WebKit architecture while adopting the stronger proportions and spacing of the existing Surffish frame.

## Implemented

### Toolbar

- Reworked the native omnibox controls to use macOS SF Symbols for sidebar, back, forward, reload/stop, security state, AdBlock, and extension installation.
- Replaced the text/emoji security indicator with a tinted native image view that distinguishes HTTPS, HTTP, and other schemes.
- Refined the address pill's contrast, corner radius, border, spacing, and height.
- Kept Bramble's existing blueberry button and preserved all existing delegate actions and navigation behaviour.

### Window frame and sidebar

- Increased the native sidebar width from 260 px to 320 px to match the supplied native-frame reference.
- Increased the toolbar height from 46 px to 50 px.
- Standardized the web-content inset to 8 px on the leading and top edges; the existing 8 px trailing and bottom insets remain.
- Rebalanced sidebar horizontal padding for the wider frame.
- Expanded the tab column and title region, and moved the close control to the right side of the wider tab row.

## Working approach

- Keep native window chrome, toolbar, sidebar, and web-content responsibilities clearly separated.
- Match the visual hierarchy and interaction density of Surffish rather than introducing a second visual language.
- Make focused, reviewable commits directly on this branch.
- Preserve existing tab, navigation, extension, AdBlock, and Bramble behaviour while changing layout.

## Validation

- GitHub write access and fast-forward push access were verified before implementation with an initial documentation commit.
- Toolbar, frame, and sidebar changes were committed directly to `poc/native-webkit-app`.
- The repository's native build script targets macOS 15.4+ and requires Apple's `xcrun swiftc`; this Linux execution environment cannot run the AppKit/WebKit build.
- Runtime layout validation on macOS remains outstanding. Run `./scripts/build-native-poc.sh`, launch `poc-native/build/SurffishNative.app`, and verify the sidebar at the minimum and default window sizes before treating the UI pass as complete.
