import assert from "node:assert/strict";
import test from "node:test";
import {
  isPermittedWikimediaPhotoLicense,
  parseCachedNewTabBackground,
  parseCachedNewTabBackgrounds,
  parseWikimediaPhotoPage,
  parseWikimediaPhotoSearchResults,
  WIKIMEDIA_NATURE_SEARCHES,
} from "./new-tab-photo-feed.ts";

function photoPage(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: "File:Alpine_lake.jpg",
    imageinfo: [
      {
        thumburl:
          "https://thumb.wikimedia.org/wikipedia/commons/thumb/photo.jpg/1920px-photo.jpg",
        descriptionurl:
          "https://commons.wikimedia.org/wiki/File:Alpine_lake.jpg",
        mime: "image/jpeg",
        width: 2400,
        height: 1600,
        extmetadata: {
          Artist: {
            value:
              '<a href="https://commons.wikimedia.org/wiki/User:Jane">Jane &amp; Alex</a>',
          },
          ObjectName: { value: "<span>Quiet &quot;Alpine Lake&quot;</span>" },
          LicenseShortName: { value: "CC BY 4.0" },
          LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
        },
      },
    ],
    ...overrides,
  };
}

test("Wikimedia candidate parsing preserves plain-text creator and title with the exact CC BY source links", () => {
  const candidate = parseWikimediaPhotoPage(photoPage());
  assert.ok(candidate);
  assert.equal(candidate.creator, "Jane & Alex");
  assert.equal(candidate.title, 'Quiet "Alpine Lake"');
  assert.equal(candidate.licenseName, "CC BY 4.0");
  assert.equal(
    candidate.sourceUrl,
    "https://commons.wikimedia.org/wiki/File:Alpine_lake.jpg",
  );
  assert.equal(
    candidate.imageUrl,
    "https://thumb.wikimedia.org/wikipedia/commons/thumb/photo.jpg/1920px-photo.jpg",
  );
});

test("the refresh uses nature-specific mountain-lake and forest-lake searches only", () => {
  assert.deepEqual(WIKIMEDIA_NATURE_SEARCHES, [
    "filetype:bitmap mountain lake photo",
    "filetype:bitmap forest lake landscape photo",
  ]);
  assert.ok(
    WIKIMEDIA_NATURE_SEARCHES.every(
      (query) => !/scenic|city|urban/i.test(query),
    ),
  );
});

test("CC0 and attribution-only CC BY license records are allowed, while ShareAlike, NC, ND, or mismatched URLs are rejected", () => {
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC0",
      "https://creativecommons.org/publicdomain/zero/1.0/",
    ),
    true,
  );
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC BY 3.0",
      "https://creativecommons.org/licenses/by/3.0/",
    ),
    true,
  );
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC BY-SA 4.0",
      "https://creativecommons.org/licenses/by-sa/4.0/",
    ),
    false,
  );
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC BY-NC 4.0",
      "https://creativecommons.org/licenses/by-nc/4.0/",
    ),
    false,
  );
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC BY-ND 4.0",
      "https://creativecommons.org/licenses/by-nd/4.0/",
    ),
    false,
  );
  assert.equal(
    isPermittedWikimediaPhotoLicense(
      "CC BY 4.0",
      "https://example.com/licenses/by/4.0/",
    ),
    false,
  );
});

test("Wikimedia candidates reject unlicensed, non-photo, too-small, portrait, or off-domain metadata", () => {
  assert.equal(
    parseWikimediaPhotoPage(
      photoPage({
        imageinfo: [
          {
            ...(photoPage().imageinfo as Record<string, unknown>[])[0],
            extmetadata: {
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: {
                value: "https://creativecommons.org/licenses/by-sa/4.0/",
              },
            },
          },
        ],
      }),
    ),
    null,
  );
  const base = (photoPage().imageinfo as Record<string, unknown>[])[0]!;
  assert.equal(
    parseWikimediaPhotoPage(
      photoPage({ imageinfo: [{ ...base, mime: "image/svg+xml" }] }),
    ),
    null,
  );
  assert.equal(
    parseWikimediaPhotoPage(
      photoPage({ imageinfo: [{ ...base, width: 800, height: 600 }] }),
    ),
    null,
  );
  assert.equal(
    parseWikimediaPhotoPage(
      photoPage({ imageinfo: [{ ...base, width: 1200, height: 1800 }] }),
    ),
    null,
  );
  assert.equal(
    parseWikimediaPhotoPage(
      photoPage({
        imageinfo: [{ ...base, thumburl: "https://example.com/photo.jpg" }],
      }),
    ),
    null,
  );
});

test("search response parsing removes duplicate source pages and ignores non-file metadata", () => {
  const result = parseWikimediaPhotoSearchResults({
    query: {
      pages: [photoPage(), photoPage(), { title: "Page without imageinfo" }],
    },
  });
  assert.equal(result.length, 1);
  assert.equal(
    result[0]?.id,
    "https://commons.wikimedia.org/wiki/File:Alpine_lake.jpg",
  );
  assert.deepEqual(
    parseWikimediaPhotoSearchResults({ query: { pages: {} } }),
    [],
  );
});

test("cached photos allow only trusted CC0/CC BY data images and keep no more than two unique entries", () => {
  const candidate = parseWikimediaPhotoPage(photoPage())!;
  const cached = {
    ...candidate,
    imageUrl: undefined,
    mimeType: undefined,
    src: "data:image/jpeg;base64,AAECAw==",
  };
  assert.ok(parseCachedNewTabBackground(cached));
  assert.equal(
    parseCachedNewTabBackground({
      ...cached,
      src: "https://upload.wikimedia.org/photo.jpg",
    }),
    null,
  );
  assert.equal(
    parseCachedNewTabBackgrounds([
      cached,
      cached,
      {
        ...cached,
        id: "https://commons.wikimedia.org/wiki/File:Second.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Second.jpg",
      },
      {
        ...cached,
        id: "https://commons.wikimedia.org/wiki/File:Third.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Third.jpg",
      },
    ]).length,
    2,
  );
});
