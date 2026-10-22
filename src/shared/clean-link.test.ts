import assert from "node:assert/strict";
import test from "node:test";
import { cleanLinkUrl, isTrackingParam } from "./clean-link.ts";

test("strips utm_* and common ad click ids, keeping real parameters in order", () => {
  assert.equal(
    cleanLinkUrl(
      "https://example.com/post?id=42&utm_source=news&utm_medium=email&fbclid=abc&page=2&gclid=x&dclid=y&msclkid=z",
    ),
    "https://example.com/post?id=42&page=2",
  );
  assert.equal(
    cleanLinkUrl(
      "https://example.com/?UTM_Campaign=x&mc_eid=1&igshid=2&ref_src=twsrc",
    ),
    "https://example.com/",
  );
});

test("drops the query entirely when nothing survives and keeps the fragment", () => {
  assert.equal(
    cleanLinkUrl("https://example.com/a?utm_source=x#section-2"),
    "https://example.com/a#section-2",
  );
  assert.equal(
    cleanLinkUrl("https://example.com/a#utm_source=x&utm_medium=y"),
    "https://example.com/a",
  );
});

test("si is only stripped on YouTube and Spotify", () => {
  assert.equal(
    cleanLinkUrl("https://youtu.be/dQw4w9WgXcQ?si=abc123&t=42"),
    "https://youtu.be/dQw4w9WgXcQ?t=42",
  );
  assert.equal(
    cleanLinkUrl(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&si=abc&feature=shared",
    ),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
  assert.equal(
    cleanLinkUrl("https://open.spotify.com/track/123?si=abc"),
    "https://open.spotify.com/track/123",
  );
  assert.equal(
    cleanLinkUrl("https://example.com/search?si=1"),
    "https://example.com/search?si=1",
  );
  assert.equal(isTrackingParam("si", "music.youtube.com"), true);
  assert.equal(isTrackingParam("si", "notyoutube.com"), false);
});

test("x.com share params are removed but t is kept on other sites", () => {
  assert.equal(
    cleanLinkUrl("https://x.com/user/status/1?s=20&t=abc"),
    "https://x.com/user/status/1",
  );
  assert.equal(
    cleanLinkUrl("https://example.com/video?t=30"),
    "https://example.com/video?t=30",
  );
});

test("keeps the original encoding of parameters that remain", () => {
  assert.equal(
    cleanLinkUrl(
      "https://example.com/s?q=hello%20world&utm_source=x&tag=a%2Bb",
    ),
    "https://example.com/s?q=hello%20world&tag=a%2Bb",
  );
  assert.equal(
    cleanLinkUrl("https://example.com/s?q=a+b&fbclid=1"),
    "https://example.com/s?q=a+b",
  );
});

test("leaves non-web and unparsable input alone", () => {
  assert.equal(
    cleanLinkUrl("mailto:me@example.com?utm_source=x"),
    "mailto:me@example.com?utm_source=x",
  );
  assert.equal(cleanLinkUrl("not a url"), "not a url");
  assert.equal(
    cleanLinkUrl("https://example.com/plain"),
    "https://example.com/plain",
  );
});
