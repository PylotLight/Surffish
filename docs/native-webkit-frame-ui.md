# Native WebKit frame and UI work

Target branch: `poc/native-webkit-app`

## Scope

Improve the native macOS browser frame and surrounding UI while preserving the existing native WebKit architecture and the current browser behaviour.

## Working approach

- Keep native window chrome, toolbar, sidebar, tab strip, and web-content responsibilities clearly separated.
- Match the visual hierarchy and interaction density of the existing Surffish design rather than introducing a second visual language.
- Treat the supplied screenshots as the visual reference for the current native shell and the desired in-page browsing presentation.
- Make focused, reviewable commits directly on this branch and validate each change with the repository's documented checks and relevant native build/smoke tests.

## Validation

- Repository write access and a fast-forward push to this branch are verified by the initial commit.
- Build and runtime validation will be recorded as implementation changes are made; a successful Git push is not a substitute for compiling or running the native app.
