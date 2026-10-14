# Reading List

Save a page to look at later. It is deliberately not a bookmark: one flat list, newest first, and
every item is unread until you open it (Safari / Orion style). Saving a page that is already there
moves it back to the top as unread instead of adding a second copy (same page = same address,
ignoring `#fragment`, a trailing slash, `www.` and http vs https).

## Where it lives

- **Toolbar button** (glasses icon, beside Bookmarks) with an unread badge. Click it for the
  popover: *Add This Page*, Unread / All, search (title, site, URL, excerpt), the list.
  - Click a row: open it here and mark it read. ⌘/Ctrl-click or middle-click: new tab. ⌥/Alt-click:
    open in Reader view. Row buttons: mark read / unread, remove. Right-click: Open, Open in New
    Tab, Open in Reader View, Mark as Read/Unread, Copy Link, Remove.
  - *All* has "Clear read items".
  - Same light-dismiss as every toolbar popover (`usePopoverDismiss`), same 13/14px type scale.
- **⇧⌘L / Ctrl+Shift+L**: add the current page (works from the page, the toolbar or Reader view).
  Safari/Orion's ⇧⌘D is Surffish's *Bookmark All Tabs* (Chrome's binding), so it stays there;
  ⇧⌘L was free (⌘L is Open Location, unshifted).
- **Page right-click**: *Add Page to Reading List*; on a link, *Add Link to Reading List* (saves the
  link with its text as the title, without opening it).
- **Tab right-click**: *Add to Reading List*.
- **Bookmarks menu**: *Add to Reading List*, *Show Reading List*.
- **⌘K**: *Add to Reading List*, *Open Reading List* (also matches "read later", "save for later",
  "todo", "pocket"…).

## Private tabs

Never offered: the items are kept in the profile database (and will sync to other devices once P2P
sync lands), which is the opposite of what a private tab promises. The menu items are disabled /
hidden, the palette entry is disabled and the shortcut shows "Private tabs can't be added to the
Reading List". Saving a link from a private tab's page is hidden too.

## Offline copy

When the page you save reads as an article (the same Readability detection that lights the Reader
button), Surffish keeps a Reader copy of it on this device. *Open in Reader View* uses the live page
when Reader detection says it is an article, otherwise the saved copy, so an item can be read
offline or after the page went away. Rows with a copy show "offline".

The copy is device-local: it is not part of the change log, and storing it doesn't count as an
edit, so it never syncs (a peer captures its own). Removing an item deletes its copy.

## Storage

`reading_list` in `surffish.db` (schema v2, `src/main/store/schema.ts`), one row per item, written
one row at a time (`src/main/store/reading-list-table.ts`). Record-based with UUIDv7 ids, `added_at`,
`read_at`, and the usual sync columns (`device_id`, `created_at`, `updated_at`, `hlc`,
`deleted_at`). The Android client's expo-sqlite schema needs the same v2 migration (minus nothing:
`snapshot` is in the table there too, just never synced).

If the database can't be opened (or `SURFFISH_STORE=json`), items go to `reading-list.json` instead
(no offline copies there).

## Perf

`src/main/reading-list.ts` (store, page metadata, Reader copy) is a lazy chunk, loaded on the first
Reading List IPC call or entry point. The toolbar asks for the unread count 1.5 s after it mounts, so
launch never loads it. The popover (`ReadingListPanel` + its CSS) is a lazy renderer chunk too; only
the button and badge are in the startup bundle.

## Tests

- Unit: `src/shared/reading-list.test.ts`, `src/main/store/reading-list-table.test.ts` (incl. v1 → v2
  migration), Reading List items in `src/main/context-menu-template.test.ts`.
- Smoke: `bun run build && bun run test:electron-reading-list` (CI lane C).
