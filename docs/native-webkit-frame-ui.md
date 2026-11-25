# Native WebKit frame and UI work

Target branch: `poc/native-webkit-app`

## Scope

Improve the native macOS browser frame and surrounding UI while preserving the existing native WebKit architecture and current browser behaviour.

## Implemented

- Reworked the native omnibox controls to use macOS SF Symbols for sidebar, back, forward, reload/stop, security state, AdBlock, and extension installation.
- Replaced the text/emoji security indicator with a tinted native image view that distinguishes HTTPS, HTTP, and other schemes.
- Refined the address pill's contrast, corner radius, border, spacing, and height.
- Kept Bramble's existing blueberry button and preserved all existing delegate actions and navigation behaviour.

## Working approach

- Keep native window chrome, toolbar, sidebar, and web-content responsibilities clearly separated.
- Match the visual hierarchy and interaction density of the existing Surffish design rather than introducing a second visual language.
- Make focused, reviewable commits directly on this branch.

## Validation

- GitHub write access and fast-forward push access were verified before implementation with the initial documentation commit.
- The toolbar implementation was pushed successfully in a separate commit.
- The native build has not been run in this environment. It requires macOS 15.4+ and the Apple Swift toolchain; run `./scripts/build-native-poc.sh` on the Mac before treating the UI change as runtime-validated.
