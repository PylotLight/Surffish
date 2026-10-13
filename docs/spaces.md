# Spaces

Named sets of tabs in the sidebar (roadmap §4.3). **Off by default**: Settings → General → Spaces → "Enable Spaces".

## Off
One Default Space, no switcher, no swipe, no shortcuts, no Space palette commands, no "Move to Space". Every tab uses `persist:surffish-browser` and nothing Space-related is written to `browser-session.json`, so it behaves like before.

Turning Spaces **off** with tabs in other Spaces asks first, then **merges every tab into Default** (tabs from Spaces with separate logins reload in the profile session). Space definitions are kept, empty, for when you turn it back on. (We chose merge over "keep them hidden" so nothing keeps running where you can't see it.)

## Model
- Definitions (name, emoji, colour, separate logins, proxy) are global, in `browser-spaces.json`. Tabs are per window: each tab carries a space id and each window shows one active Space.
- **Two windows may show the same Space.** Each keeps its own tabs in it (definitions are shared, tabs aren't). A new window opens on the Space you're in. Private windows have no Spaces.
- Pinned tabs are per Space. Bookmarks (including the Favourites folder shown in the pinned strip) stay global.
- Switcher at the bottom of the sidebar; right-click a Space for rename / icon / colour / separate logins / proxy / move / delete. Ctrl+1..9 on macOS (Cmd+1..9 still selects tabs), Ctrl+Shift+1..9 elsewhere. Two-finger horizontal swipe over the sidebar (macOS native swipe module) steps through Spaces.
- Delete asks before closing the Space's tabs (in every window) and wipes a separate partition's data.
- "Move to Space" (tab menu, palette) moves a split as one unit. You stay where you are. Moving between partitions reloads the page from its URL (a page can't change session; back/forward history is lost).
- Activating a tab from another Space (palette, archive restore, extensions) switches to that Space.
- Closing the last tab of a Space while the window has other tabs leaves a New Tab in that Space.

## Partitions
`src/main/browser-session.ts`: `getPageSession(partition)` + `onPageSessionCreated(setup)`. Ad blocking, permission handler, proxy, request gates / webRequest hooks, downloads, spellcheck and the encrypted session-cookie snapshot all register once and run for every page session (profile, private, `persist:surffish-space-<id>`). Default stays `persist:surffish-browser`. Private tabs are unchanged.

Not ported to Space partitions: Web Store / Bramble extensions (they stay in the profile session; extension pages always open in Default) and the macOS WebKit Google sign-in hand-off (partitioned Spaces sign in to Google inside the tab).

## Proxy precedence
A Space with separate logins can force a route ("Same as Settings", Direct, main proxy, or a named proxy). Chromium sets proxies per session, so a forced proxy needs separate logins. Highest first:
1. local addresses always direct
2. a per-site rule to a proxy keeps its proxy
3. a per-site Direct rule stays direct, except in a Space forced through a proxy, where it uses the Space's proxy (a proxied Space never leaks direct)
4. the Space's forced route
5. Settings' main proxy on/off

A forced named proxy that was removed fails closed onto the main proxy. The kill switch watches every proxy any Space uses and judges each request by its page's session.
