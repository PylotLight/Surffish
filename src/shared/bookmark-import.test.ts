import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  buildFirefoxBookmarkTree,
  chromiumTimeToMs,
  countImportedBookmarks,
  decodeHtmlEntities,
  exportNetscapeBookmarks,
  macAbsoluteTimeToMs,
  parseChromiumBookmarks,
  parseChromiumProfileNames,
  parseFirefoxProfilesIni,
  parseNetscapeBookmarks,
  parseSafariBookmarks,
  prTimeToMs,
} from "./bookmark-import.ts";
import { isBinaryPlist, parseBinaryPlist } from "./bplist.ts";
import {
  addBookmark,
  addBookmarkFolder,
  createBookmarkStore,
  importBookmarkTree,
  toImportedTree,
  FAVOURITES_FOLDER_TITLE,
  type ImportedBookmarkNode,
} from "./bookmarks.ts";

const fixtures = join(import.meta.dir, "fixtures");

test("converts browser timestamps to JS milliseconds", () => {
  // 2024-01-01T00:00:00Z
  const ms = Date.UTC(2024, 0, 1);
  assert.equal(chromiumTimeToMs(String((ms + 11_644_473_600_000) * 1000)), ms);
  assert.equal(chromiumTimeToMs("0"), undefined);
  assert.equal(chromiumTimeToMs("not a number"), undefined);
  assert.equal(prTimeToMs(ms * 1000), ms);
  assert.equal(macAbsoluteTimeToMs((ms - Date.UTC(2001, 0, 1)) / 1000), ms);
});

test("parses a Chromium Bookmarks JSON file root by root", () => {
  const chromeTime = String((Date.UTC(2023, 5, 1) + 11_644_473_600_000) * 1000);
  const tree = parseChromiumBookmarks({
    checksum: "x",
    version: 1,
    roots: {
      bookmark_bar: {
        type: "folder",
        name: "Bookmarks bar",
        date_added: chromeTime,
        children: [
          {
            type: "url",
            name: "GitHub",
            url: "https://github.com/",
            date_added: chromeTime,
          },
          {
            type: "folder",
            name: "Reading",
            children: [
              { type: "url", name: "HN", url: "https://news.ycombinator.com/" },
            ],
          },
        ],
      },
      other: {
        type: "folder",
        name: "",
        children: [
          { type: "url", name: "Other one", url: "https://other.test/" },
        ],
      },
      synced: { type: "folder", name: "Mobile bookmarks", children: [] },
    },
  });
  assert.deepEqual(tree, [
    {
      title: "Bookmarks bar",
      dateAdded: Date.UTC(2023, 5, 1),
      children: [
        {
          title: "GitHub",
          url: "https://github.com/",
          dateAdded: Date.UTC(2023, 5, 1),
        },
        {
          title: "Reading",
          children: [{ title: "HN", url: "https://news.ycombinator.com/" }],
        },
      ],
    },
    {
      title: "Other bookmarks",
      children: [{ title: "Other one", url: "https://other.test/" }],
    },
  ]);
  assert.throws(() => parseChromiumBookmarks({ nope: true }), /Chromium/);
});

test("reads Chromium profile display names from Local State", () => {
  const names = parseChromiumProfileNames({
    profile: {
      info_cache: {
        Default: { name: "Person 1" },
        "Profile 3": { name: "Work" },
        Bad: 7,
      },
    },
  });
  assert.deepEqual(
    [...names],
    [
      ["Default", "Person 1"],
      ["Profile 3", "Work"],
    ],
  );
  assert.equal(parseChromiumProfileNames(null).size, 0);
});

test("parses Firefox profiles.ini and picks the install default", () => {
  const profiles = parseFirefoxProfilesIni(
    [
      "[Install4F96D1932A9F858E]",
      "Default=Profiles/abc.default-release",
      "Locked=1",
      "",
      "[Profile1]",
      "Name=default",
      "IsRelative=1",
      "Path=Profiles/xyz.default",
      "Default=1",
      "",
      "[Profile0]",
      "Name=default-release",
      "IsRelative=1",
      "Path=Profiles/abc.default-release",
      "",
      "[Profile2]",
      "Name=Elsewhere",
      "IsRelative=0",
      "Path=/Volumes/data/ff",
      "",
      "[General]",
      "StartWithLastProfile=1",
    ].join("\r\n"),
  );
  assert.deepEqual(profiles, [
    {
      name: "default",
      path: "Profiles/xyz.default",
      isRelative: true,
      isDefault: false,
    },
    {
      name: "default-release",
      path: "Profiles/abc.default-release",
      isRelative: true,
      isDefault: true,
    },
    {
      name: "Elsewhere",
      path: "/Volumes/data/ff",
      isRelative: false,
      isDefault: false,
    },
  ]);
});

test("builds the Firefox bookmark tree from places rows, skipping tags and separators", () => {
  const added = Date.UTC(2022, 1, 2) * 1000;
  const tree = buildFirefoxBookmarkTree([
    {
      id: 1,
      type: 2,
      parent: 0,
      position: 0,
      title: "",
      guid: "root________",
      url: null,
      dateAdded: added,
    },
    {
      id: 2,
      type: 2,
      parent: 1,
      position: 0,
      title: "menu",
      guid: "menu________",
      url: null,
      dateAdded: added,
    },
    {
      id: 3,
      type: 2,
      parent: 1,
      position: 1,
      title: "toolbar",
      guid: "toolbar_____",
      url: null,
      dateAdded: added,
    },
    {
      id: 4,
      type: 2,
      parent: 1,
      position: 2,
      title: "tags",
      guid: "tags________",
      url: null,
      dateAdded: added,
    },
    {
      id: 5,
      type: 2,
      parent: 1,
      position: 3,
      title: "unfiled",
      guid: "unfiled_____",
      url: null,
      dateAdded: added,
    },
    {
      id: 6,
      type: 2,
      parent: 1,
      position: 4,
      title: "mobile",
      guid: "mobile______",
      url: null,
      dateAdded: added,
    },
    {
      id: 10,
      type: 1,
      parent: 3,
      position: 1,
      title: "Second",
      guid: "g10",
      url: "https://second.test/",
      dateAdded: added,
    },
    {
      id: 11,
      type: 1,
      parent: 3,
      position: 0,
      title: "First",
      guid: "g11",
      url: "https://first.test/",
      dateAdded: added,
    },
    {
      id: 12,
      type: 3,
      parent: 3,
      position: 2,
      title: null,
      guid: "g12",
      url: null,
      dateAdded: added,
    },
    {
      id: 13,
      type: 2,
      parent: 2,
      position: 0,
      title: "Mozilla",
      guid: "g13",
      url: null,
      dateAdded: added,
    },
    {
      id: 14,
      type: 1,
      parent: 13,
      position: 0,
      title: "Get Help",
      guid: "g14",
      url: "https://support.mozilla.org/",
      dateAdded: null,
    },
    {
      id: 15,
      type: 1,
      parent: 4,
      position: 0,
      title: "tagged",
      guid: "g15",
      url: "https://tagged.test/",
      dateAdded: added,
    },
    {
      id: 16,
      type: 1,
      parent: 5,
      position: 0,
      title: "Smart",
      guid: "g16",
      url: "place:sort=8",
      dateAdded: added,
    },
  ]);
  assert.deepEqual(tree, [
    {
      title: "Bookmarks Toolbar",
      dateAdded: Date.UTC(2022, 1, 2),
      children: [
        {
          title: "First",
          url: "https://first.test/",
          dateAdded: Date.UTC(2022, 1, 2),
        },
        {
          title: "Second",
          url: "https://second.test/",
          dateAdded: Date.UTC(2022, 1, 2),
        },
      ],
    },
    {
      title: "Bookmarks Menu",
      dateAdded: Date.UTC(2022, 1, 2),
      children: [
        {
          title: "Mozilla",
          dateAdded: Date.UTC(2022, 1, 2),
          children: [
            { title: "Get Help", url: "https://support.mozilla.org/" },
          ],
        },
      ],
    },
    {
      title: "Other Bookmarks",
      dateAdded: Date.UTC(2022, 1, 2),
      children: [
        {
          title: "Smart",
          url: "place:sort=8",
          dateAdded: Date.UTC(2022, 1, 2),
        },
      ],
    },
  ]);
});

test("reads a binary plist and parses Safari bookmarks from it", () => {
  const bytes = new Uint8Array(
    readFileSync(join(fixtures, "safari-bookmarks.plist")),
  );
  assert.equal(isBinaryPlist(bytes), true);
  const plist = parseBinaryPlist(bytes) as Record<string, unknown>;
  assert.equal(plist.WebBookmarkType, "WebBookmarkTypeList");
  const sync = (
    (plist.Children as Array<Record<string, unknown>>)[3]!.Children as Array<
      Record<string, unknown>
    >
  )[0]!.Sync as Record<string, unknown>;
  assert.deepEqual([...(sync.Data as Uint8Array)], [0, 1, 2]);
  assert.equal(sync.Big, 2 ** 40);
  assert.equal(sync.Neg, -5);
  assert.equal(sync.F, 1.5);
  assert.equal(sync.B, true);
  const tree = parseSafariBookmarks(plist as never);
  assert.deepEqual(tree, [
    {
      title: "Favorites",
      children: [
        { title: "Apple", url: "https://www.apple.com/" },
        {
          title: "Dev – tools",
          children: [
            {
              title: "MDN Web Docs 📘",
              url: "https://developer.mozilla.org/en-US/",
            },
            { title: "Bookmarklet", url: "javascript:alert(1)" },
          ],
        },
      ],
    },
    {
      title: "Reading List",
      children: [
        {
          title: "Long read",
          url: "https://example.com/article",
          dateAdded: Date.UTC(2024, 4, 1, 12),
        },
      ],
    },
  ]);
  assert.throws(
    () =>
      parseBinaryPlist(
        new TextEncoder().encode('<?xml version="1.0"?><plist></plist>'),
      ),
    /binary/,
  );
  assert.throws(() => parseBinaryPlist(bytes.slice(0, 60)), /Corrupt/);
  assert.throws(() => parseSafariBookmarks({ nope: 1 }), /Safari/);
});

test("parses a Netscape bookmarks file as Chrome and Firefox write it", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. <DL> inside a comment is ignored -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://github.com/?a=1&amp;b=2" ADD_DATE="1700000000" ICON="data:image/png;base64,AAA">Git&lt;Hub&gt; &amp; co</A>
        <DT><H3>Empty</H3>
        <DL><p>
        </DL><p>
        <DT><a href='https://single.test/'>single <b>quoted</b></a>
        <DD>A description that is ignored
    </DL><p>
    <DT><A HREF="https://top.test/">Top&#39;s &#x1F600;</A>
</DL><p>`;
  assert.deepEqual(parseNetscapeBookmarks(html), [
    {
      title: "Bookmarks bar",
      dateAdded: 1_700_000_000_000,
      children: [
        {
          title: "Git<Hub> & co",
          url: "https://github.com/?a=1&b=2",
          dateAdded: 1_700_000_000_000,
        },
        { title: "Empty", children: [] },
        { title: "single quoted", url: "https://single.test/" },
      ],
    },
    { title: "Top's 😀", url: "https://top.test/" },
  ]);
  assert.throws(
    () => parseNetscapeBookmarks("<html><body>hello</body></html>"),
    /no bookmarks/,
  );
  assert.equal(decodeHtmlEntities("&unknown; &#0; &amp;"), "&unknown; &#0; &");
});

test("Netscape export and import round-trip the bookmark tree", () => {
  const store = createBookmarkStore(1);
  let id = 0;
  const makeId = (): string => `x${++id}`;
  const seconds = 1_650_000_000_000;
  addBookmark(
    store,
    {
      title: 'Quotes "and" <tags> & stuff',
      url: 'https://a.test/?q="x"&y=<1>',
      dateAdded: seconds,
    },
    makeId,
  );
  const folder = addBookmarkFolder(
    store,
    { title: "Folder & co", dateAdded: seconds },
    makeId,
  );
  const nested = addBookmarkFolder(
    store,
    { parentId: folder.id, title: "Nested", dateAdded: seconds },
    makeId,
  );
  addBookmark(
    store,
    {
      parentId: nested.id,
      title: "Ünïcödé ✓",
      url: "https://unicode.test/path#frag",
      dateAdded: seconds + 999,
    },
    makeId,
  );
  addBookmark(
    store,
    {
      parentId: folder.id,
      title: "Plain",
      url: "https://plain.test/",
      dateAdded: seconds,
    },
    makeId,
  );
  const tree = toImportedTree(store);
  const html = exportNetscapeBookmarks(tree, {
    toolbarFolderTitle: FAVOURITES_FOLDER_TITLE,
  });
  assert.match(html, /<DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Favourites<\/H3>/);
  const parsed = parseNetscapeBookmarks(html);
  const roundSeconds = (
    nodes: ImportedBookmarkNode[],
  ): ImportedBookmarkNode[] =>
    nodes.map((node) => ({
      ...node,
      ...(node.dateAdded
        ? { dateAdded: Math.floor(node.dateAdded / 1000) * 1000 }
        : {}),
      ...(node.children ? { children: roundSeconds(node.children) } : {}),
    }));
  // The 1 ms store creation date is below a second, so it isn't exported.
  const expected = roundSeconds(tree).map((node) =>
    node.title === FAVOURITES_FOLDER_TITLE
      ? { title: node.title, children: node.children }
      : node,
  );
  assert.deepEqual(parsed, expected);
  assert.equal(countImportedBookmarks(parsed), 3);
  // Re-importing the export into a fresh store reproduces it under "Imported from".
  const fresh = createBookmarkStore(1);
  const result = importBookmarkTree(fresh, "HTML file", parsed, makeId);
  assert.equal(result.added, 3);
  assert.equal(result.folders, 3);
});
