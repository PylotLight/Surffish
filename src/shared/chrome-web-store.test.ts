import assert from "node:assert/strict";
import test from "node:test";
import {
  chromeWebStoreCrxUrl,
  compareExtensionVersions,
  isAllowedChromeWebStoreDownloadUrl,
  isChromeWebStoreDetailUrl,
  normalizeChromeVersion,
  parseChromeWebStoreInput,
} from "./chrome-web-store.ts";

const MHN = "dabkegjlekdcmefifaolmdhnhdcplklo";

test("parses Web Store detail URLs and bare IDs", () => {
  for (const input of [
    MHN,
    `  ${MHN.toUpperCase()}  `,
    `https://chromewebstore.google.com/detail/modern-for-hacker-news/${MHN}`,
    `https://chromewebstore.google.com/detail/modern-for-hacker-news/${MHN}?hl=en&authuser=0`,
    `chromewebstore.google.com/detail/modern-for-hacker-news/${MHN}`,
    `https://chromewebstore.google.com/detail/${MHN}`,
    `https://chrome.google.com/webstore/detail/modern-for-hacker-news/${MHN}`,
    `https://chromewebstore.google.com/detail/modern-for-hacker-news/${MHN}#reviews`,
  ]) {
    assert.equal(parseChromeWebStoreInput(input), MHN, input);
  }
});

test("rejects lookalike hosts, non-detail paths, and malformed IDs", () => {
  for (const input of [
    "",
    "hello",
    "dabkegjlekdcmefifaolmdhnhdcplkl", // 31 chars
    "dabkegjlekdcmefifaolmdhnhdcplklz", // z is outside a–p
    `https://evil.example/detail/x/${MHN}`,
    `https://chromewebstore.google.com.evil.example/detail/x/${MHN}`,
    `https://chromewebstore.google.com/category/extensions`,
    `https://chromewebstore.google.com/detail/a/b/${MHN}`,
    `https://user:pass@chromewebstore.google.com/detail/x/${MHN}`,
    `javascript:alert(1)//chromewebstore.google.com/detail/x/${MHN}`,
    null,
    42,
  ]) {
    assert.equal(parseChromeWebStoreInput(input), null, String(input));
  }
  assert.equal(
    isChromeWebStoreDetailUrl(
      `https://chromewebstore.google.com/detail/x/${MHN}`,
    ),
    true,
  );
  assert.equal(isChromeWebStoreDetailUrl(MHN), false);
});

test("builds the update-service CRX URL for the running Chrome version", () => {
  assert.equal(normalizeChromeVersion("152.0.7310.5"), "152.0.7310.5");
  assert.equal(normalizeChromeVersion("152"), "152.0.0.0");
  assert.equal(
    chromeWebStoreCrxUrl(MHN, "152.0.7310.5"),
    `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=152.0.7310.5&acceptformat=crx2,crx3&x=id%3D${MHN}%26uc`,
  );
  assert.throws(() => chromeWebStoreCrxUrl("nope", "152"));
});

test("allows only Google update/CDN hosts for the download", () => {
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl(
      "https://clients2.google.com/service/update2/crx",
    ),
    true,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl(
      "https://clients2.googleusercontent.com/crx/blobs/x.crx",
    ),
    true,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl(
      "https://edgedl.me.gvt1.com/edgedl/x.crx",
    ),
    true,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl("http://clients2.google.com/x"),
    false,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl("https://clients2.google.com:8443/x"),
    false,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl(
      "https://googleusercontent.com.evil.example/x",
    ),
    false,
  );
  assert.equal(
    isAllowedChromeWebStoreDownloadUrl("https://example.com/x.crx"),
    false,
  );
});

test("compares dotted extension versions numerically", () => {
  assert.equal(compareExtensionVersions("1.14", "1.9"), 1);
  assert.equal(compareExtensionVersions("1.14", "1.14.0"), 0);
  assert.equal(compareExtensionVersions("2.0.0.1", "2.0.1"), -1);
});
