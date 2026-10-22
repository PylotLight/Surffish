import { describe, expect, test } from "bun:test";
import {
  historyFingerprint,
  omniboxPrerenderUrl,
  prerenderBlockedBy,
  prerenderUrlSkip,
  sameNavigationUrl,
  type PrerenderConditions,
} from "./omnibox-prerender";

describe("omniboxPrerenderUrl", () => {
  const hint = (
    input: string,
    suggestionUrl: string | null,
    suggestionSource: string | null,
    resolvedUrl: string | null,
  ) =>
    omniboxPrerenderUrl({
      input,
      suggestionUrl,
      suggestionSource,
      resolvedUrl,
    });

  test("typed text that resolves to exactly a history or bookmark URL prerenders it", () => {
    expect(
      hint(
        "news.ycombinator.com",
        "https://news.ycombinator.com/",
        "History",
        "https://news.ycombinator.com/",
      ),
    ).toBe("https://news.ycombinator.com/");
    expect(
      hint(
        "github.com",
        "https://github.com/",
        "Bookmark",
        "https://github.com",
      ),
    ).toBe("https://github.com/");
    expect(
      hint(
        "example.org/docs",
        "https://example.org/docs",
        "Pinned site",
        "https://example.org/docs",
      ),
    ).toBe("https://example.org/docs");
  });

  test("an arrowed-onto suggestion (the bar holds its URL) prerenders", () => {
    const url = "https://en.wikipedia.org/wiki/Fish";
    expect(hint(url, url, "History", url)).toBe(url);
  });

  test("a partial match, a search, or another page never prerenders", () => {
    expect(
      hint(
        "news",
        "https://news.ycombinator.com/",
        "History",
        "https://duckduckgo.com/?q=news",
      ),
    ).toBeNull();
    expect(
      hint(
        "github.com",
        "https://github.com/PylotLight",
        "History",
        "https://github.com/",
      ),
    ).toBeNull();
    expect(
      hint("github.com", "https://github.com/", "History", null),
    ).toBeNull();
  });

  test("open tabs and unknown sources never prerender", () => {
    expect(
      hint(
        "github.com",
        "https://github.com/",
        "Open tab",
        "https://github.com/",
      ),
    ).toBeNull();
    expect(
      hint("github.com", "https://github.com/", null, "https://github.com/"),
    ).toBeNull();
  });

  test("too little typed text never prerenders", () => {
    expect(hint("a.co", "https://a.co/", "History", "https://a.co/")).toBe(
      "https://a.co/",
    );
    expect(hint("ab", "https://ab/", "History", "https://ab/")).toBeNull();
  });

  test("unsafe URLs never prerender even when they match", () => {
    const url = "https://example.com/logout";
    expect(hint(url, url, "History", url)).toBeNull();
  });
});

describe("prerenderUrlSkip", () => {
  test("plain pages are fine", () => {
    expect(prerenderUrlSkip("https://example.com/")).toBeNull();
    expect(
      prerenderUrlSkip("http://example.com/blog/2026/likely-story"),
    ).toBeNull();
    expect(prerenderUrlSkip("https://example.com/search?q=fish")).toBeNull();
    expect(prerenderUrlSkip("https://catalog.example.com/")).toBeNull();
  });

  test("non-web schemes and credentials are skipped", () => {
    expect(prerenderUrlSkip("file:///etc/passwd")).toBe("not-http");
    expect(prerenderUrlSkip("surffish://settings")).toBe("not-http");
    expect(prerenderUrlSkip("not a url")).toBe("not-http");
    expect(prerenderUrlSkip("https://user:pw@example.com/")).toBe(
      "credentials",
    );
  });

  test("state-changing GETs are skipped", () => {
    for (const url of [
      "https://example.com/logout",
      "https://example.com/account/sign-out",
      "https://example.com/signout?next=/",
      "https://example.com/items/42/delete",
      "https://mail.example.com/unsubscribe?id=1",
      "https://shop.example.com/checkout",
      "https://example.com/login/oauth/authorize?client_id=x",
      "https://example.com/?action=logout",
      "https://example.com/auth/callback?code=1",
    ])
      expect(prerenderUrlSkip(url)).toBe("unsafe");
  });

  test("downloads are skipped", () => {
    expect(
      prerenderUrlSkip("https://example.com/Surffish-0.1.20-mac-arm64.zip"),
    ).toBe("file");
    expect(prerenderUrlSkip("https://example.com/paper.pdf")).toBe("file");
  });
});

describe("sameNavigationUrl", () => {
  test("normalizes before comparing", () => {
    expect(sameNavigationUrl("https://a.com", "https://a.com/")).toBe(true);
    expect(sameNavigationUrl("HTTPS://A.com/x", "https://a.com/x")).toBe(true);
    expect(sameNavigationUrl("https://a.com/x", "https://a.com/y")).toBe(false);
    expect(sameNavigationUrl("https://a.com/#top", "https://a.com/")).toBe(
      false,
    );
    expect(sameNavigationUrl(null, "https://a.com/")).toBe(false);
    expect(sameNavigationUrl("nope", "nope")).toBe(false);
  });
});

describe("prerenderBlockedBy", () => {
  const ok: PrerenderConditions = {
    enabled: true,
    isPrivate: false,
    onBattery: false,
    memoryTight: false,
    proxyBlocking: false,
    tabEligible: true,
  };

  test("all clear starts a prerender", () => {
    expect(prerenderBlockedBy(ok)).toBeNull();
  });

  test("each condition blocks on its own", () => {
    expect(prerenderBlockedBy({ ...ok, enabled: false })).toBe("disabled");
    expect(prerenderBlockedBy({ ...ok, isPrivate: true })).toBe("private");
    expect(prerenderBlockedBy({ ...ok, tabEligible: false })).toBe("tab");
    expect(prerenderBlockedBy({ ...ok, proxyBlocking: true })).toBe("proxy");
    expect(prerenderBlockedBy({ ...ok, onBattery: true })).toBe("battery");
    expect(prerenderBlockedBy({ ...ok, memoryTight: true })).toBe("memory");
  });

  test("private wins over everything but the setting", () => {
    expect(
      prerenderBlockedBy({
        ...ok,
        isPrivate: true,
        onBattery: true,
        memoryTight: true,
      }),
    ).toBe("private");
  });
});

describe("historyFingerprint", () => {
  test("covers entries up to the current one", () => {
    const entries = [
      { url: "https://a/" },
      { url: "https://b/" },
      { url: "https://c/" },
    ];
    expect(historyFingerprint({ entries, index: 1 })).toBe(
      "https://a/\nhttps://b/",
    );
    expect(historyFingerprint({ entries, index: 2 })).not.toBe(
      historyFingerprint({ entries, index: 1 }),
    );
    expect(historyFingerprint(null)).toBe("");
    expect(historyFingerprint({ entries: [], index: -1 })).toBe("");
  });
});
