import { describe, expect, test } from "bun:test";
import config from "../app.config.mjs";
import { resolveTarget, targetFromRelease } from "../lib/release.mjs";

const SHA = "9435b0ee8b6b5697edab4b31730c2a0c42d47efc25db1e2d9f39205e1d0db216";
const release = (tag, assets) => ({ tag_name: tag, assets });
const asset = (version, extra = {}) => ({
  name: `Surffish-${version}-mac-arm64.zip`,
  size: 124889704,
  browser_download_url: `https://github.com/PylotLight/Surffish/releases/download/v${version}/Surffish-${version}-mac-arm64.zip`,
  ...extra,
});

/** fetch stub: url -> { status, json | text }; records calls */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(String(url));
    const r = routes[String(url)];
    if (!r) return new Response("not found", { status: 404 });
    return new Response(r.text ?? JSON.stringify(r.json), {
      status: r.status ?? 200,
    });
  };
  return { impl, calls };
}

describe("resolveTarget", () => {
  test("pinned + matching release.json makes no network call", async () => {
    const { impl, calls } = stubFetch({});
    const t = await resolveTarget(
      config,
      { kind: "pinned", version: "0.1.22" },
      {
        env: {},
        fetchImpl: impl,
        manifest: { version: "0.1.22", sha256: SHA, asset: "", size: 1 },
      },
    );
    expect(calls).toEqual([]);
    expect(t.sha256).toBe(SHA);
    expect(t.url).toBe(asset("0.1.22").browser_download_url);
    expect(t.checksumSource).toMatch(/npm package/);
  });
  test("pinned without a matching manifest uses the asset digest from the API", async () => {
    const { impl, calls } = stubFetch({
      "https://api.github.com/repos/PylotLight/Surffish/releases/tags/v0.1.21":
        {
          json: release("v0.1.21", [
            asset("0.1.21", { digest: `sha256:${SHA}` }),
          ]),
        },
    });
    const t = await resolveTarget(
      config,
      { kind: "pinned", version: "0.1.21" },
      {
        env: {},
        fetchImpl: impl,
        manifest: {
          version: "0.1.22",
          sha256: "f".repeat(64),
          asset: "",
          size: 1,
        },
      },
    );
    expect(calls).toHaveLength(1);
    expect(t).toMatchObject({
      version: "0.1.21",
      sha256: SHA,
      size: 124889704,
      checksumSource: "GitHub release asset digest",
    });
  });
  test("--latest reads releases/latest", async () => {
    const { impl } = stubFetch({
      "https://api.github.com/repos/PylotLight/Surffish/releases/latest": {
        json: release("v0.1.30", [
          asset("0.1.30", { digest: `sha256:${SHA}` }),
        ]),
      },
    });
    const t = await resolveTarget(
      config,
      { kind: "latest" },
      { env: {}, fetchImpl: impl },
    );
    expect(t.version).toBe("0.1.30");
  });
  test("falls back to a SHA256SUMS asset when there is no digest", async () => {
    const sumsUrl = "https://example.test/SHA256SUMS";
    const { impl } = stubFetch({
      [sumsUrl]: { text: `${SHA}  Surffish-0.1.5-mac-arm64.zip\n` },
    });
    const t = await targetFromRelease(
      config,
      release("v0.1.5", [
        asset("0.1.5"),
        { name: "SHA256SUMS", browser_download_url: sumsUrl },
      ]),
      { fetchImpl: impl },
    );
    expect(t).toMatchObject({ sha256: SHA, checksumSource: "SHA256SUMS" });
  });
  test("no checksum anywhere -> sha256 null", async () => {
    const t = await targetFromRelease(
      config,
      release("v0.1.5", [asset("0.1.5")]),
      { fetchImpl: stubFetch({}).impl },
    );
    expect(t).toMatchObject({ sha256: null, checksumSource: "none" });
  });
  test("a missing release is a clear error", async () => {
    await expect(
      resolveTarget(
        config,
        { kind: "pinned", version: "9.9.9" },
        { env: {}, fetchImpl: stubFetch({}).impl },
      ),
    ).rejects.toThrow(/no GitHub release v9\.9\.9/);
  });
  test("rate limits mention GITHUB_TOKEN", async () => {
    const impl = async () => new Response("{}", { status: 403 });
    await expect(
      resolveTarget(config, { kind: "latest" }, { env: {}, fetchImpl: impl }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });
  test("env overrides (test asset)", async () => {
    const t = await resolveTarget(
      config,
      { kind: "latest" },
      {
        env: {
          SURFFISH_CLI_ASSET_URL: "http://127.0.0.1/x.zip",
          SURFFISH_CLI_SHA256: SHA,
          SURFFISH_CLI_VERSION: "1.2.3",
        },
      },
    );
    expect(t).toMatchObject({
      version: "1.2.3",
      url: "http://127.0.0.1/x.zip",
      sha256: SHA,
    });
  });
});
