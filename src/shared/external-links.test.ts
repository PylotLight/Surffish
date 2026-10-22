import { describe, expect, test } from "bun:test";
import {
  externalOpenTarget,
  externalOpenTargetsFromArgv,
  isLocalDocumentUrl,
} from "./external-links";

describe("externalOpenTarget", () => {
  test("accepts explicit web URLs", () => {
    expect(externalOpenTarget("https://example.com/a?b=1#c")).toBe(
      "https://example.com/a?b=1#c",
    );
    expect(externalOpenTarget("HTTP://Example.com")).toBe(
      "http://example.com/",
    );
  });

  test("refuses searches, bare hosts and other schemes", () => {
    expect(externalOpenTarget("example.com")).toBeNull();
    expect(externalOpenTarget("hello world")).toBeNull();
    expect(externalOpenTarget("javascript:alert(1)")).toBeNull();
    expect(externalOpenTarget("surffish://quick-links")).toBeNull();
    expect(externalOpenTarget("chrome://settings")).toBeNull();
    expect(externalOpenTarget("data:text/html,hi")).toBeNull();
    expect(externalOpenTarget("https://")).toBeNull();
    expect(externalOpenTarget("--flag=https://example.com")).toBeNull();
    expect(externalOpenTarget("")).toBeNull();
  });

  test("accepts local PDF and HTML documents only", () => {
    expect(externalOpenTarget("/Users/me/Downloads/report.pdf")).toBe(
      "file:///Users/me/Downloads/report.pdf",
    );
    expect(externalOpenTarget("/tmp/My Page.HTML")).toBe(
      "file:///tmp/My%20Page.HTML",
    );
    expect(externalOpenTarget("file:///tmp/a.htm#top")).toBe(
      "file:///tmp/a.htm",
    );
    expect(externalOpenTarget("C:\\docs\\a.pdf")).toBe("file:///C:/docs/a.pdf");
    expect(externalOpenTarget("/tmp/script.sh")).toBeNull();
    expect(externalOpenTarget("/tmp/app/out/main/index.js")).toBeNull();
    expect(externalOpenTarget("relative/a.pdf")).toBeNull();
    expect(externalOpenTarget("file://server/share/a.pdf")).toBeNull();
    expect(externalOpenTarget("file:///tmp/a.pdf?x=1")).toBeNull();
  });
});

describe("externalOpenTargetsFromArgv", () => {
  test("skips the executable, the entry script and switches", () => {
    expect(
      externalOpenTargetsFromArgv([
        "/opt/Surffish/surffish",
        "--allow-file-access-from-files",
        "out/main/index.js",
        "--",
        "https://example.com/",
        "/home/me/a.pdf",
        "https://example.com/",
      ]),
    ).toEqual(["https://example.com/", "file:///home/me/a.pdf"]);
    expect(externalOpenTargetsFromArgv(["https://example.com/"])).toEqual([]);
  });
});

describe("isLocalDocumentUrl", () => {
  test("matches file URLs with document extensions", () => {
    expect(isLocalDocumentUrl("file:///a/b.pdf")).toBe(true);
    expect(isLocalDocumentUrl("file:///a/b.xhtml")).toBe(true);
    expect(isLocalDocumentUrl("file:///a/b")).toBe(false);
    expect(isLocalDocumentUrl("https://a/b.pdf")).toBe(false);
  });
});
