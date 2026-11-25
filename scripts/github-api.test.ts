import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkGitHubApi,
  createGitHubRelease,
  curlArgs,
  curlAuthConfig,
  findReleaseByTag,
  githubApiConfigFromEnv,
  parseCurlOutput,
  releaseAssetUploadUrl,
} from "./github-api.ts";

const config = {
  repo: "o/r",
  token: "t0k",
  proxy: "socks5h://127.0.0.1:1080",
  api: "https://api.github.com",
  uploads: "https://uploads.github.com",
};

// One adaptive fake curl (scripts/test-setup/fake-github-curl.sh), copied to a temp
// dir and warmed once at module load, handles all three scenarios in the "release"
// test (create / reuse-existing / 404) via a state file. bun's spawn cache is
// per-script, and the first spawnSync("curl") is slow (~2s: it resolves the binary
// and lazily loads its bash interpreter libraries); priming the exact script here
// with a trivial call (which hits the `*)` 404 case and never touches the v9
// release state the test body relies on) means the test body only ever sees
// already-warmed spawns, keeping it well under bun's hard 5s default even under
// --parallel=4.
const releaseDir = mkdtempSync(join(tmpdir(), "fake-curl-release-"));
const releaseLog = join(releaseDir, "log");
const fakeCurlPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "test-setup",
  "fake-github-curl.sh",
);
writeFileSync(releaseLog, "");
writeFileSync(join(releaseDir, "curl"), readFileSync(fakeCurlPath));
chmodSync(join(releaseDir, "curl"), 0o755);
writeFileSync(join(releaseDir, "S.zip"), "zip");
{
  const savedPath = process.env.PATH;
  const savedFd = process.env.FAKE_RELEASE_DIR;
  process.env.PATH = `${releaseDir}:${savedPath}`;
  process.env.FAKE_RELEASE_DIR = releaseDir;
  try {
    // Warm the bash interpreter once (the slow first spawn) by running the full
    // fake-curl script with a trivial call. A trivial call hits the `*)` 404 case,
    // so it never touches the v9 release state the test body relies on, and the
    // state file is never created.
    spawnSync("curl", ["--version"]);
  } catch {
    /* ignore */
  }
  process.env.PATH = savedPath;
  process.env.FAKE_RELEASE_DIR = savedFd;
}

test("config: null without SURFFISH_GH_PROXY (ghp fallback), token preference, missing token throws", () => {
  assert.equal(githubApiConfigFromEnv({ GITHUB_TOKEN: "x" }, "o/r"), null);
  assert.equal(
    githubApiConfigFromEnv({ SURFFISH_GH_PROXY: "  " }, "o/r"),
    null,
  );
  const c = githubApiConfigFromEnv(
    {
      SURFFISH_GH_PROXY: "socks5h://h:1",
      SURFFISH_GH_TOKEN: "a",
      GITHUB_TOKEN: "b",
    },
    "o/r",
  );
  assert.equal(c?.token, "a");
  assert.equal(c?.proxy, "socks5h://h:1");
  assert.equal(
    githubApiConfigFromEnv({ SURFFISH_GH_PROXY: "p", GH_TOKEN: "g" }, "o/r")
      ?.token,
    "g",
  );
  assert.throws(
    () => githubApiConfigFromEnv({ SURFFISH_GH_PROXY: "p" }, "o/r"),
    /no token/,
  );
});

test("curl args: proxy only via --proxy, token never on the command line, bodies via files", () => {
  const get = curlArgs(config, {
    method: "GET",
    url: "https://api.github.com/repos/o/r",
  });
  assert.deepEqual(
    get.slice(get.indexOf("--proxy"), get.indexOf("--proxy") + 2),
    ["--proxy", config.proxy],
  );
  assert.ok(!get.join(" ").includes("t0k"));
  assert.ok(
    get.includes("--config") && get[get.indexOf("--config") + 1] === "-",
  );
  assert.equal(get.at(-1), "https://api.github.com/repos/o/r");
  const post = curlArgs(
    config,
    { method: "POST", url: "u", body: { a: 1 } },
    "/tmp/b.json",
  );
  assert.ok(
    post.includes("@/tmp/b.json") &&
      post.includes("Content-Type: application/json"),
  );
  const up = curlArgs(
    { ...config, proxy: undefined },
    {
      method: "POST",
      url: "u",
      uploadFile: "/x/a b.zip",
      contentType: "application/zip",
      maxTimeSeconds: 1800,
    },
  );
  assert.ok(!up.includes("--proxy"));
  assert.ok(
    up.includes("@/x/a b.zip") &&
      up.includes("Content-Type: application/zip") &&
      up.includes("1800"),
  );
});

test("auth config, output parsing, upload url, tag lookup", () => {
  assert.equal(curlAuthConfig("abc"), 'header = "Authorization: Bearer abc"\n');
  assert.throws(() => curlAuthConfig('a"b'));
  assert.deepEqual(parseCurlOutput('{"x":1}\n200'), {
    status: 200,
    json: { x: 1 },
  });
  assert.deepEqual(parseCurlOutput("\n000"), { status: 0, json: null });
  assert.deepEqual(parseCurlOutput(""), { status: 0, json: null });
  assert.equal(
    releaseAssetUploadUrl(
      "https://uploads.github.com",
      "o/r",
      7,
      "Surffish 0.1.3.zip",
    ),
    "https://uploads.github.com/repos/o/r/releases/7/assets?name=Surffish%200.1.3.zip",
  );
  assert.equal(
    findReleaseByTag<{ tag_name?: string; id?: number }>(
      [{ tag_name: "v1" }, { tag_name: "v2", id: 2 }],
      "v2",
    )?.id,
    2,
  );
  assert.equal(findReleaseByTag({ message: "nope" }, "v2"), undefined);
});

// A fake curl on PATH that answers like the GitHub API and logs each call (method, url, proxy, stdin).
function withFakeCurl(
  fn: (log: () => string[]) => void,
  opts: { existingRelease?: boolean } = {},
): void {
  const dir = mkdtempSync(join(tmpdir(), "fake-curl-"));
  const logFile = join(dir, "log");
  writeFileSync(logFile, "");
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
method=GET; url=""; proxy=""
while [ $# -gt 0 ]; do
  case "$1" in -X) method="$2"; shift;; --proxy) proxy="$2"; shift;; -o|-w|-H|--max-time|--config|--data-binary) shift;; -*) ;; *) url="$1";; esac
  shift
done
stdin="$(cat)"
echo "$method $url proxy=$proxy auth=$([[ "$stdin" == *"Bearer t0k"* ]] && echo yes || echo no)" >> "${logFile}"
case "$method $url" in
  "GET https://api.github.com/repos/o/r") printf '{"full_name":"o/r"}\\n200';;
  "GET https://api.github.com/repos/o/r/releases?per_page=5") printf '[{"tag_name":"v0.1.1"}]\\n200';;
  "GET https://api.github.com/repos/o/r/git/ref/tags/v9") printf '{"ref":"refs/tags/v9"}\\n200';;
  "GET https://api.github.com/repos/o/r/releases?per_page=100") ${opts.existingRelease ? `printf '[{"tag_name":"v9","id":5,"draft":true,"assets":[]}]\\n200'` : `printf '[]\\n200'`};;
  "POST https://api.github.com/repos/o/r/releases") printf '{"id":5,"draft":true,"assets":[]}\\n201';;
  "POST https://uploads.github.com/repos/o/r/releases/5/assets?name=S.zip") printf '{"name":"S.zip","size":3}\\n201';;
  "PATCH https://api.github.com/repos/o/r/releases/5") printf '{"html_url":"https://github.com/o/r/releases/tag/v9"}\\n200';;
  "GET https://api.github.com/repos/o/r/releases/5") printf '{"assets":[{"name":"S.zip"}]}\\n200';;
  *) printf '{"message":"Not Found"}\\n404';;
esac
`,
  );
  chmodSync(join(dir, "curl"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${dir}:${path}`;
  try {
    fn(() => readFileSync(logFile, "utf8").trim().split("\n"));
  } finally {
    process.env.PATH = path;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("dry-run check is read-only GETs through the proxy with auth", () => {
  withFakeCurl((log) => {
    const lines = checkGitHubApi(config);
    assert.match(lines[1] ?? "", /v0\.1\.1/);
    for (const call of log())
      assert.match(
        call,
        /^GET .* proxy=socks5h:\/\/127\.0\.0\.1:1080 auth=yes$/,
      );
  });
});

test("release: verify tag -> draft -> upload -> publish", () => {
  const zipPath = join(releaseDir, "S.zip");
  const snapshot = () => readFileSync(releaseLog, "utf8").trim().split("\n");
  const savedPath = process.env.PATH;
  const savedFd = process.env.FAKE_RELEASE_DIR;
  process.env.PATH = `${releaseDir}:${savedPath}`;
  // Pin the fake curl's log/state to this dir so its paths are deterministic
  // regardless of how bun resolves the spawned binary ($0).
  process.env.FAKE_RELEASE_DIR = releaseDir;
  try {
    // Scenario 1: full create -> upload -> publish flow.
    const before = snapshot();
    const result = createGitHubRelease(config, {
      tag: "v9",
      title: "S v9",
      notes: "n",
      assetPath: zipPath,
    });
    const createdLog = snapshot().slice(before.length);
    assert.equal(result.url, "https://github.com/o/r/releases/tag/v9");
    assert.deepEqual(result.assets, ["S.zip"]);
    assert.deepEqual(
      createdLog.map((l) => l.split(" ").slice(0, 2).join(" ")),
      [
        "GET https://api.github.com/repos/o/r/git/ref/tags/v9",
        "GET https://api.github.com/repos/o/r/releases?per_page=100",
        "POST https://api.github.com/repos/o/r/releases",
        "POST https://uploads.github.com/repos/o/r/releases/5/assets?name=S.zip",
        "PATCH https://api.github.com/repos/o/r/releases/5",
        "GET https://api.github.com/repos/o/r/releases/5",
      ],
    );

    // Scenario 2: an existing draft is reused (no create POST).
    const beforeReuse = snapshot();
    createGitHubRelease(config, {
      tag: "v9",
      title: "S v9",
      notes: "n",
      assetPath: zipPath,
    });
    const reusedLog = snapshot().slice(beforeReuse.length);
    assert.ok(
      !reusedLog.some((l) =>
        l.startsWith("POST https://api.github.com/repos/o/r/releases "),
      ),
      "reuses the existing draft",
    );

    // Scenario 3: an unknown tag 404s.
    assert.throws(
      () =>
        createGitHubRelease(config, {
          tag: "v8",
          title: "",
          notes: "",
          assetPath: zipPath,
        }),
      /tag v8 not found.*HTTP 404 Not Found/,
    );
  } finally {
    process.env.PATH = savedPath;
    process.env.FAKE_RELEASE_DIR = savedFd;
    rmSync(releaseDir, { recursive: true, force: true });
  }
});
