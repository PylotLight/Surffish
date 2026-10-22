import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import {
  isBrambleSetupPageUrl,
  planSetupTabClose,
} from "./bramble-setup-close";

const require = createRequire(import.meta.url);
const page = require("./bramble-setup-close-page.cjs") as {
  presentVaultKeys: (items: unknown) => string[];
  newVaultKeys: (before: unknown, after: unknown) => string[];
  isSetupPageUrl: (href: string) => boolean;
  looksDone: (snapshot: unknown) => boolean;
  shouldClose: (state: unknown) => boolean;
  CLOSE_DELAY_MS: number;
};

const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/";
const DONE = { heading: true, checkIcon: true, controls: 0, spinner: false };

describe("isBrambleSetupPageUrl", () => {
  test("options.html of this extension, without ?screen=", () => {
    expect(isBrambleSetupPageUrl(`${EXT}options.html`, EXT)).toBe(true);
    expect(isBrambleSetupPageUrl(`${EXT}options.html#join`, EXT)).toBe(true);
  });
  test("import / restore from Settings, other pages and other extensions keep their tab", () => {
    expect(isBrambleSetupPageUrl(`${EXT}options.html?screen=import`, EXT)).toBe(
      false,
    );
    expect(
      isBrambleSetupPageUrl(`${EXT}options.html?screen=restore`, EXT),
    ).toBe(false);
    expect(isBrambleSetupPageUrl(`${EXT}popup.html`, EXT)).toBe(false);
    expect(
      isBrambleSetupPageUrl(
        "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/options.html",
        EXT,
      ),
    ).toBe(false);
    expect(isBrambleSetupPageUrl("https://example.com/options.html", EXT)).toBe(
      false,
    );
    expect(isBrambleSetupPageUrl("not a url", EXT)).toBe(false);
  });
});

describe("planSetupTabClose", () => {
  test("closes the tab when the window has others", () => {
    expect(planSetupTabClose({ tabCount: 3, mini: false })).toBe("close");
  });
  test("the last tab becomes a New Tab instead of closing the window", () => {
    expect(planSetupTabClose({ tabCount: 1, mini: false })).toBe(
      "replace-with-new-tab",
    );
  });
  test("a mini window just closes with its last tab", () => {
    expect(planSetupTabClose({ tabCount: 1, mini: true })).toBe("close");
  });
});

describe("setup-close page helpers", () => {
  test("presentVaultKeys lists registered vaults that hold a blob, plus the legacy key", () => {
    expect(
      page.presentVaultKeys({
        "vault.registry": {
          vaults: [{ id: "a" }, { id: "b" }, { id: "" }, null],
        },
        "vault-blob-b64:a": "Zm9v",
        "vault-blob-b64:b": "",
        "vault-blob-b64:orphan": "Zm9v",
      }),
    ).toEqual(["vault-blob-b64:a"]);
    expect(page.presentVaultKeys({ "vault-blob-b64": "Zm9v" })).toEqual([
      "vault-blob-b64",
    ]);
    expect(page.presentVaultKeys({})).toEqual([]);
    expect(page.presentVaultKeys(null)).toEqual([]);
  });
  test("newVaultKeys finds a vault this page session created", () => {
    expect(page.newVaultKeys([], ["vault-blob-b64:a"])).toEqual([
      "vault-blob-b64:a",
    ]);
    expect(
      page.newVaultKeys(
        ["vault-blob-b64:a"],
        ["vault-blob-b64:a", "vault-blob-b64:b"],
      ),
    ).toEqual(["vault-blob-b64:b"]);
    expect(
      page.newVaultKeys(["vault-blob-b64:a"], ["vault-blob-b64:a"]),
    ).toEqual([]);
  });
  test("isSetupPageUrl matches the main-process check", () => {
    expect(page.isSetupPageUrl(`${EXT}options.html`)).toBe(true);
    expect(page.isSetupPageUrl(`${EXT}options.html?screen=import`)).toBe(false);
    expect(page.isSetupPageUrl(`${EXT}popup.html`)).toBe(false);
  });
  test("looksDone: check icon + heading, nothing to press, no spinner", () => {
    expect(page.looksDone(DONE)).toBe(true);
    // Connecting to your other device… (spinner, no check)
    expect(
      page.looksDone({
        heading: true,
        checkIcon: false,
        controls: 0,
        spinner: true,
      }),
    ).toBe(false);
    // Recovery code screen (has a Continue button), forms with errors
    expect(page.looksDone({ ...DONE, controls: 1 })).toBe(false);
    expect(page.looksDone({ ...DONE, spinner: true })).toBe(false);
    expect(page.looksDone(null)).toBe(false);
  });
  test("shouldClose needs the done screen AND a new vault from this session", () => {
    const base = {
      setupPage: true,
      screen: DONE,
      baseline: [],
      current: ["vault-blob-b64:a"],
    };
    expect(page.shouldClose(base)).toBe(true);
    // Existing vault, options.html opened normally: nothing new, never closes.
    expect(page.shouldClose({ ...base, baseline: ["vault-blob-b64:a"] })).toBe(
      false,
    );
    // Failure: still on the form.
    expect(
      page.shouldClose({ ...base, screen: { ...DONE, controls: 4 } }),
    ).toBe(false);
    // Storage could not be read at load.
    expect(page.shouldClose({ ...base, baseline: null })).toBe(false);
    expect(page.shouldClose({ ...base, setupPage: false })).toBe(false);
  });
  test("closes after a short visible delay", () => {
    expect(page.CLOSE_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(page.CLOSE_DELAY_MS).toBeLessThanOrEqual(2500);
  });
});
