import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  compareBrambleVersions,
  downloadVerifiedBrambleFirefoxRelease,
  extractBrambleFirefoxArchive,
} from "../../src/main/bramble-release.ts";
import { stageBrambleFirefoxBuild } from "../../src/main/bramble-poc-adapter.ts";

const RELEASES_API = "https://api.github.com/repos/bramble-sh/bramble/releases?per_page=100";
const targetDirectory = process.argv[2];
if (!targetDirectory) {
  throw new Error("Usage: bun poc/cef/stage-bramble.mjs <staged-output-directory>");
}

/** Follow only GitHub's same-host canonical repository-ID redirect for this public API. */
async function brambleReleaseFetcher(input, init = {}) {
  const original = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    original.origin !== "https://api.github.com" ||
    original.pathname !== "/repos/bramble-sh/bramble/releases"
  ) {
    return fetch(input, init);
  }

  let current = original;
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location || hop === 2) {
      throw new Error("Bramble releases API returned an invalid redirect.");
    }
    const next = new URL(location, current);
    const allowedCanonicalPath = /^\/repositories\/\d+\/releases$/.test(
      next.pathname,
    );
    const allowedQuery = [...next.searchParams.keys()].every(
      (key) => key === "per_page" || key === "page",
    );
    if (
      next.protocol !== "https:" ||
      next.origin !== "https://api.github.com" ||
      next.port ||
      next.username ||
      next.password ||
      next.hash ||
      !allowedCanonicalPath ||
      !allowedQuery ||
      next.searchParams.get("per_page") !== "100"
    ) {
      throw new Error(
        "Bramble releases API redirected outside the expected GitHub endpoint.",
      );
    }
    current = next;
  }
  throw new Error("Bramble releases API redirect limit exceeded.");
}

function releaseDigest(asset) {
  if (typeof asset?.digest !== "string") return null;
  const match = /^sha256:([a-f\d]{64})$/i.exec(asset.digest);
  if (!match) throw new Error(`GitHub returned an invalid digest for ${asset.name}.`);
  return match[1].toLowerCase();
}

function verifiedAssetUrl(asset, tag, name) {
  if (!asset || asset.name !== name || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error(`Bramble release is missing a valid ${name} asset.`);
  }
  const url = new URL(asset.browser_download_url);
  const expectedPath = `/bramble-sh/bramble/releases/download/${tag}/${name}`;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== expectedPath ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Bramble release contains an unexpected URL for ${name}.`);
  }
  return url.toString();
}

async function selectLatestFirefoxRelease() {
  const response = await brambleReleaseFetcher(RELEASES_API, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Could not check Bramble releases on GitHub (HTTP ${response.status}).`);
  }
  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error("GitHub returned an invalid releases list.");
  const candidates = releases.flatMap((release) => {
    if (!release || release.draft === true || release.prerelease === true) return [];
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-firefox$/.exec(release.tag_name ?? "");
    return match
      ? [{ release, version: `${match[1]}.${match[2]}.${match[3]}`, tag: release.tag_name }]
      : [];
  });
  candidates.sort((left, right) => compareBrambleVersions(right.version, left.version));
  const selected = candidates[0];
  if (!selected) throw new Error("No stable Bramble Firefox release is available.");

  const assets = Array.isArray(selected.release.assets) ? selected.release.assets : [];
  const zipName = `bramble_firefox_${selected.version}.zip`;
  const zips = assets.filter((asset) => asset?.name === zipName);
  const checksumFiles = assets.filter((asset) => asset?.name === "SHA256SUMS");
  if (zips.length !== 1 || checksumFiles.length !== 1) {
    throw new Error(`Bramble ${selected.version} must publish one Firefox ZIP and SHA256SUMS.`);
  }
  const zip = zips[0];
  const checksums = checksumFiles[0];
  return {
    version: selected.version,
    tag: selected.tag,
    zipName,
    zipUrl: verifiedAssetUrl(zip, selected.tag, zipName),
    zipSize: zip.size,
    githubDigest: releaseDigest(zip),
    checksumsUrl: verifiedAssetUrl(checksums, selected.tag, "SHA256SUMS"),
    checksumsSize: checksums.size,
    checksumsGithubDigest: releaseDigest(checksums),
  };
}

const target = resolve(targetDirectory);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "surffish-bramble-cef-poc-"));
try {
  const release = await selectLatestFirefoxRelease();
  const verified = await downloadVerifiedBrambleFirefoxRelease(
    brambleReleaseFetcher,
    release,
  );
  const sourceDirectory = join(temporaryDirectory, "firefox");
  extractBrambleFirefoxArchive(verified.archive, sourceDirectory);
  const staged = stageBrambleFirefoxBuild(sourceDirectory, target);
  console.log(JSON.stringify({
    version: verified.release.version,
    tag: verified.release.tag,
    zipName: verified.release.zipName,
    sha256: verified.sha256,
    stagedDirectory: staged.stagedDirectory,
    adaptedVersion: staged.version,
  }, null, 2));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
