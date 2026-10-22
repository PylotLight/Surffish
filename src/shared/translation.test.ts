import { describe, expect, test } from "bun:test";
import {
  buildPageTranslationUrl,
  buildTextTranslationUrl,
  DEFAULT_TRANSLATION_LANGUAGE,
  isTranslationLanguage,
  parseTranslationResponse,
  TRANSLATION_LANGUAGES,
} from "./translation";

describe("translation helpers", () => {
  test("offers common languages and validates exact supported codes", () => {
    expect(TRANSLATION_LANGUAGES.length).toBeGreaterThanOrEqual(20);
    expect(DEFAULT_TRANSLATION_LANGUAGE).toBe("en");
    expect(isTranslationLanguage("zh-CN")).toBe(true);
    expect(isTranslationLanguage("xx")).toBe(false);
    expect(isTranslationLanguage(null)).toBe(false);
  });
  test("builds website translation links preserving the public URL", () => {
    const result = buildPageTranslationUrl(
      "https://example.com/path?q=1#fragment",
      "fr",
    )!;
    const url = new URL(result);
    expect(url.origin).toBe("https://translate.google.com");
    expect(url.pathname).toBe("/translate");
    expect(url.searchParams.get("sl")).toBe("auto");
    expect(url.searchParams.get("tl")).toBe("fr");
    expect(url.searchParams.get("u")).toBe("https://example.com/path?q=1");
    expect(buildPageTranslationUrl("file:///tmp/a", "fr")).toBeNull();
    expect(
      buildPageTranslationUrl("https://user:pass@example.com/", "fr"),
    ).toBeNull();
    for (const host of [
      "localhost",
      "printer.local",
      "127.0.0.1",
      "10.0.0.2",
      "192.168.1.1",
      "172.20.0.1",
      "[::1]",
    ]) {
      expect(buildPageTranslationUrl(`https://${host}/`, "fr")).toBeNull();
    }
    expect(buildPageTranslationUrl("https://example.com", "xx")).toBeNull();
  });
  test("does not mistake public hostname prefixes for private IPv6 ranges", () => {
    expect(buildPageTranslationUrl("https://fda.gov/", "en")).not.toBeNull();
    expect(
      buildPageTranslationUrl("https://fc.example.com/", "en"),
    ).not.toBeNull();
    for (const host of [
      "printer.lan",
      "app.internal",
      "service.home",
      "localhost.",
      "100.64.0.1",
      "198.18.0.1",
      "2130706433",
      "0x7f000001",
      "[::ffff:127.0.0.1]",
    ]) {
      expect(buildPageTranslationUrl(`http://${host}/`, "en")).toBeNull();
    }
  });
  test("builds text translation links with bounded nonempty text", () => {
    const result = buildTextTranslationUrl("  hello world  ", "ja")!;
    const url = new URL(result);
    expect(url.origin).toBe("https://translate.google.com");
    expect(url.searchParams.get("text")).toBe("hello world");
    expect(url.searchParams.get("op")).toBe("translate");
    expect(buildTextTranslationUrl(" ".repeat(2), "en")).toBeNull();
    expect(buildTextTranslationUrl("a".repeat(5001), "en")).toBeNull();
    expect(buildTextTranslationUrl("a".repeat(5000), "en")).not.toBeNull();
  });
  test("parses provider translation segments as plain text and rejects malformed payloads", () => {
    expect(
      parseTranslationResponse([
        [
          ["Bonjour ", "Hello "],
          ["monde", "world"],
        ],
      ]),
    ).toBe("Bonjour monde");
    expect(parseTranslationResponse([[["<b>safe text</b>", "source"]]])).toBe(
      "<b>safe text</b>",
    );
    for (const response of [
      null,
      {},
      [],
      [[]],
      [[[]]],
      [[[1, "source"]]],
      [[["  ", "source"]]],
      [[["x".repeat(50001), "source"]]],
    ]) {
      expect(() => parseTranslationResponse(response)).toThrow();
    }
  });
});
