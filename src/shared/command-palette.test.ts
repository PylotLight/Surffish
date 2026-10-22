import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPaletteItems,
  formatAccelerator,
  fuzzyScore,
  looksLikeAddress,
  matchFields,
  parseRecentCommandIds,
  recordRecentCommand,
  type CommandDescriptor,
  type PaletteSources,
} from "./command-palette.ts";
import { DEFAULT_CUSTOM_SEARCH_ENGINES } from "./search-keywords.ts";
import type { BrowserTabSummary } from "./types.ts";

const command = (
  id: string,
  title: string,
  extra: Partial<CommandDescriptor> = {},
): CommandDescriptor => ({
  id,
  title,
  keywords: [],
  accelerator: null,
  section: "Tab",
  enabled: true,
  ...extra,
});
const tab = (
  id: string,
  title: string,
  url: string,
  extra: Partial<BrowserTabSummary> = {},
): BrowserTabSummary => ({
  id,
  title,
  url,
  faviconUrl: null,
  loading: false,
  active: false,
  pinned: false,
  sleeping: false,
  audible: false,
  muted: false,
  private: false,
  ...extra,
});

const COMMANDS = [
  command("tab.new", "New Tab", { accelerator: "CmdOrCtrl+T" }),
  command("tab.close", "Close Tab", { accelerator: "CmdOrCtrl+W" }),
  command("tab.pin", "Pin Tab", { accelerator: "CmdOrCtrl+Shift+P" }),
  command("tab.suspendOthers", "Suspend Other Tabs", {
    keywords: ["hibernate", "sleep"],
  }),
  command("view.zoomIn", "Zoom In", {
    accelerator: "CmdOrCtrl+=",
    section: "View",
  }),
  command("pdf.edit", "Edit PDF", { enabled: false }),
];

const sources = (patch: Partial<PaletteSources>): PaletteSources => ({
  query: "",
  mode: "all",
  commands: COMMANDS,
  recentCommandIds: [],
  tabs: [],
  pinnedSites: [],
  history: [],
  searchEngines: DEFAULT_CUSTOM_SEARCH_ENGINES,
  defaultSearchLabel: "Brave Search",
  platform: "darwin",
  ...patch,
});

test("formats accelerators per platform", () => {
  assert.equal(formatAccelerator("CmdOrCtrl+Shift+P", "darwin"), "⇧⌘P");
  assert.equal(formatAccelerator("CmdOrCtrl+Shift+P", "linux"), "Ctrl+Shift+P");
  assert.equal(formatAccelerator("CmdOrCtrl+Alt+Shift+C", "darwin"), "⌥⇧⌘C");
  assert.equal(formatAccelerator("Cmd+Y", "darwin"), "⌘Y");
  assert.equal(formatAccelerator("Ctrl+H", "win32"), "Ctrl+H");
  assert.equal(formatAccelerator("CmdOrCtrl+Plus", "darwin"), "⌘+");
  assert.equal(formatAccelerator("CmdOrCtrl++", "linux"), "Ctrl++");
  assert.equal(formatAccelerator("CmdOrCtrl+[", "darwin"), "⌘[");
  assert.equal(formatAccelerator("F6", "darwin"), "F6");
  assert.equal(formatAccelerator(null, "darwin"), null);
});

test("fuzzy scores prefer prefixes, word starts and runs", () => {
  assert.equal(fuzzyScore("xyz", "New Tab"), null);
  assert.ok(fuzzyScore("nt", "New Tab") !== null);
  assert.ok(fuzzyScore("new", "New Tab")! > fuzzyScore("tab", "New Tab")!);
  assert.ok(fuzzyScore("tab", "New Tab")! > fuzzyScore("ab", "New Tab")!);
  assert.ok(
    fuzzyScore("cot", "Close Other Tabs")! >
      fuzzyScore("cot", "Recent Downloads Folder Tool")! ||
      fuzzyScore("cot", "Recent Downloads Folder Tool") === null,
  );
  assert.equal(fuzzyScore("", "anything"), 0);
});

test("every term must match some field", () => {
  assert.ok(matchFields("close tab", ["Close Tab"]) !== null);
  assert.equal(matchFields("close window", ["Close Tab"]), null);
  assert.ok(
    matchFields("sleep", ["Suspend Other Tabs", "hibernate sleep"]) !== null,
  );
});

test("empty query lists enabled commands, recent first", () => {
  const items = buildPaletteItems(
    sources({ recentCommandIds: ["view.zoomIn", "tab.pin", "gone"] }),
  );
  assert.deepEqual(
    items.map((item) => item.key),
    [
      "command:view.zoomIn",
      "command:tab.pin",
      "command:tab.new",
      "command:tab.close",
      "command:tab.suspendOthers",
    ],
  );
  assert.equal(items[0]!.kind === "command" && items[0]!.shortcut, "⌘=");
  assert.equal(items[0]!.subtitle, "Recent");
});

test("disabled commands are hidden", () => {
  assert.ok(
    !buildPaletteItems(sources({ query: "pdf" })).some(
      (item) => item.key === "command:pdf.edit",
    ),
  );
});

test("keywords find commands and recent use breaks ties", () => {
  assert.equal(
    buildPaletteItems(sources({ query: "hibernate" }))[0]!.key,
    "command:tab.suspendOthers",
  );
  const plain = buildPaletteItems(sources({ query: "tab" }))
    .filter((item) => item.kind === "command")
    .map((item) => item.key);
  const boosted = buildPaletteItems(
    sources({ query: "tab", recentCommandIds: ["tab.suspendOthers"] }),
  )
    .filter((item) => item.kind === "command")
    .map((item) => item.key);
  assert.notEqual(plain[0], "command:tab.suspendOthers");
  assert.equal(boosted[0], "command:tab.suspendOthers");
});

test("mixes tabs, favourites and history and de-duplicates URLs", () => {
  const items = buildPaletteItems(
    sources({
      query: "github",
      tabs: [
        tab(
          "t1",
          "PylotLight/Surffish",
          "https://github.com/PylotLight/Surffish",
        ),
      ],
      pinnedSites: [
        { title: "GitHub", url: "https://github.com/" },
        { title: "Same as tab", url: "https://github.com/PylotLight/Surffish" },
      ],
      history: [
        { id: "h1", url: "https://github.com/", title: "GitHub", visitedAt: 2 },
        {
          id: "h2",
          url: "https://github.com/notifications",
          title: "Notifications",
          visitedAt: 1,
        },
        { id: "h3", url: "javascript:alert(1)", title: "github", visitedAt: 0 },
      ],
    }),
  );
  const keys = items.map((item) => item.key);
  assert.ok(keys.includes("tab:t1"));
  assert.ok(keys.includes("site:https://github.com/"));
  assert.ok(keys.includes("history:https://github.com/notifications"));
  assert.ok(!keys.includes("history:https://github.com/"));
  assert.ok(!keys.some((key) => key.includes("javascript")));
  assert.equal(
    items.filter(
      (item) =>
        item.kind === "site" &&
        item.url === "https://github.com/PylotLight/Surffish",
    ).length,
    0,
  );
  assert.equal(items.at(-1)!.kind, "search");
  assert.equal(items.at(-1)!.title, "Search Brave Search for “github”");
});

test("keyword searches lead the list; addresses get an Open row", () => {
  const keyword = buildPaletteItems(sources({ query: "yt lofi" }));
  assert.equal(keyword[0]!.kind, "search");
  assert.equal(keyword[0]!.title, "Search YouTube for “lofi”");
  assert.equal(
    buildPaletteItems(sources({ query: "!gh" }))[0]!.title,
    "Open GitHub",
  );
  assert.equal(
    buildPaletteItems(sources({ query: "example.com/a" })).at(-1)!.title,
    "Open example.com/a",
  );
});

test("tab mode lists only tabs, in order when the query is empty", () => {
  const tabs = [
    tab("a", "Alpha", "https://a.test/", { active: true }),
    tab("b", "Beta", "https://b.test/"),
  ];
  const all = buildPaletteItems(sources({ mode: "tabs", tabs }));
  assert.deepEqual(
    all.map((item) => item.key),
    ["tab:a", "tab:b"],
  );
  assert.match(all[0]!.subtitle, /Current tab/);
  assert.deepEqual(
    buildPaletteItems(sources({ mode: "tabs", tabs, query: "beta" })).map(
      (item) => item.key,
    ),
    ["tab:b"],
  );
  assert.deepEqual(
    buildPaletteItems(sources({ mode: "tabs", tabs, query: "new tab" })),
    [],
  );
});

test("address detection", () => {
  assert.ok(looksLikeAddress("example.com"));
  assert.ok(looksLikeAddress("localhost:3000/x"));
  assert.ok(looksLikeAddress("https://x"));
  assert.ok(!looksLikeAddress("new tab"));
  assert.ok(!looksLikeAddress("hello"));
});

test("recent command list stays unique and bounded", () => {
  assert.deepEqual(recordRecentCommand(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.equal(
    recordRecentCommand(
      Array.from({ length: 30 }, (_v, i) => `c${i}`),
      "new",
    ).length,
    20,
  );
  assert.deepEqual(parseRecentCommandIds(["a", "a", 3, "", "b"]), ["a", "b"]);
  assert.deepEqual(parseRecentCommandIds("nope"), []);
});
