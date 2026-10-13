# Feeds

Settings → **Integrations** → **Feeds** (Integrations has two tabs, Extensions and Feeds; also
Window → Feeds, and **Feeds** / **Add Feed from This Site…** in the Cmd+K palette, which open the
Feeds tab directly) follows RSS 2.0, RSS 1.0 (RDF), Atom and JSON Feed, plus GitHub Actions workflow
runs.

- **Add** a feed address, or a site address: a page that advertises exactly one feed is followed
  through to it; several are offered to pick from. **Add feed from this site** lists the
  `<link rel="alternate" type="application/rss+xml|atom+xml|feed+json">` feeds of the current tab.
- **GitHub repository**: `owner/repo` (or any github.com URL) → Releases, Commits, Tags
  (GitHub's own `.atom` feeds) or **Actions runs**. On a github.com repo page, discovery offers
  the same four.
- **Actions runs** come from the public REST API
  (`api.github.com/repos/{owner}/{repo}/actions/runs`) without sign-in: public repos only, 60
  requests/hour per IP shared with anything else on the network, so they are polled at most
  every 15 minutes and a rate-limit answer waits for `X-RateLimit-Reset`. Only finished runs
  are listed (keyed by run id + attempt, so a re-run shows up again).
- Clicking an item opens it in a new tab and marks it read; **Mark all read** works per feed
  or across all feeds. The unread count shows on the Integrations entry in the
  Settings nav and on the Feeds tab.
- Desktop notifications for new items are **off by default**, per feed. The first fetch of a
  feed never notifies.

## How checks work

- `src/shared/feeds.ts` is the pure part (parsers, merge/dedupe, scheduling, backoff), tested in
  `src/shared/feeds.test.ts` with fixtures in `src/shared/fixtures/feeds/`.
- `src/main/feeds.ts` (store + poller + network) is a lazily imported chunk: it loads after the
  first window has painted and startup work is done, or on the first Feeds IPC call.
  `src/main/feeds-ipc.ts` is the small always-loaded part (IPC + reveal). In the renderer the
  Feeds view only mounts when its tab is selected, so opening Integrations on Extensions does not
  render it.
- Fetches go through the browser session (SOCKS proxy applies) without cookies; the proxy kill
  switch defers checks instead of going direct. Conditional GET (ETag / Last-Modified, 304s).
  Errors back off (interval doubled per error, max 24 h); `Retry-After` is honoured.
- One timer at most, `unref`'d, and none when no feed is followed or all are paused. Default
  interval 30 min (5 min minimum), per feed or global. 100 feeds, 200 items per feed.
- Stored in `feeds.json` in the profile (0600).

Smoke: `bun run build && bun run test:electron-feeds` (local fixture server).
