/**
 * Minimal GitHub REST client for scripts/release.ts: curl, optionally through a proxy for these
 * calls only (SURFFISH_GH_PROXY, e.g. socks5h://127.0.0.1:1080 on the self-hosted Mac, whose
 * network blocks non-enterprise GitHub API tokens on the direct route). No global https_proxy.
 *
 * The token goes to curl on stdin (`--config -`), never on the command line, so it doesn't show
 * up in `ps`. Request bodies go through a temp file.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface GitHubApiConfig {
  repo: string;
  token: string;
  proxy?: string;
  api?: string;
  uploads?: string;
}

export interface ApiResponse {
  status: number;
  json: unknown;
  error?: string;
}

export interface CurlRequest {
  method: string;
  url: string;
  /** JSON body (sent from a temp file) */
  body?: unknown;
  /** raw file upload (--data-binary @file) */
  uploadFile?: string;
  contentType?: string;
  maxTimeSeconds?: number;
}

type JsonObject = Record<string, unknown>;
interface ReleaseAsset {
  name?: string;
  state?: string;
}
interface Release {
  tag_name?: string;
  draft?: boolean;
  id: number;
  assets?: ReleaseAsset[];
  html_url?: string;
}
const asObject = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
const DEFAULT_API = "https://api.github.com";
const DEFAULT_UPLOADS = "https://uploads.github.com";

/** The release env -> config, or null when the proxy isn't set (release.ts then falls back to ghp). */
export function githubApiConfigFromEnv(
  env: Record<string, string | undefined>,
  repo: string,
): GitHubApiConfig | null {
  const proxy = env.SURFFISH_GH_PROXY?.trim();
  if (!proxy) return null;
  const token = (
    env.SURFFISH_GH_TOKEN ||
    env.GITHUB_TOKEN ||
    env.GH_TOKEN ||
    ""
  ).trim();
  if (!token)
    throw new Error(
      "SURFFISH_GH_PROXY is set but there is no token (SURFFISH_GH_TOKEN, GITHUB_TOKEN or GH_TOKEN)",
    );
  return {
    repo,
    token,
    proxy,
    api: env.GITHUB_API_URL || DEFAULT_API,
    uploads: DEFAULT_UPLOADS,
  };
}

/** curl argv (without the url's token or body content: those go via stdin config / temp file). */
export function curlArgs(
  config: GitHubApiConfig,
  request: CurlRequest,
  bodyFile?: string,
): string[] {
  const args = [
    "-sS",
    "--max-time",
    String(request.maxTimeSeconds ?? 60),
    "-X",
    request.method,
    "-o",
    "-",
    "-w",
    "\n%{http_code}",
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    "X-GitHub-Api-Version: 2022-11-28",
    "--config",
    "-",
  ];
  if (config.proxy) args.push("--proxy", config.proxy);
  if (request.uploadFile !== undefined) {
    args.push(
      "-H",
      `Content-Type: ${request.contentType ?? "application/octet-stream"}`,
      "--data-binary",
      `@${request.uploadFile}`,
    );
  } else if (bodyFile !== undefined) {
    args.push(
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      `@${bodyFile}`,
    );
  }
  args.push(request.url);
  return args;
}

/** curl config read from stdin: just the auth header, quoted for curl's config syntax. */
export function curlAuthConfig(token: string): string {
  if (/["\\\r\n]/.test(token))
    throw new Error("token has characters curl config can't carry");
  return `header = "Authorization: Bearer ${token}"\n`;
}

/** Splits `-w '\n%{http_code}'` output into status + parsed JSON. */
export function parseCurlOutput(stdout: string): {
  status: number;
  json: unknown;
} {
  const cut = stdout.lastIndexOf("\n");
  const status = Number(stdout.slice(cut + 1).trim()) || 0;
  let json: unknown = null;
  try {
    json = JSON.parse(stdout.slice(0, Math.max(cut, 0)));
  } catch {
    /* not JSON */
  }
  return { status, json };
}

export function releaseAssetUploadUrl(
  uploadsBase: string,
  repo: string,
  releaseId: number,
  name: string,
): string {
  return `${uploadsBase}/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`;
}

export function findReleaseByTag<T extends { tag_name?: string }>(
  releases: unknown,
  tag: string,
): T | undefined {
  return Array.isArray(releases)
    ? (releases as T[]).find((release) => release?.tag_name === tag)
    : undefined;
}

export function describeFailure(what: string, response: ApiResponse): string {
  const messageValue = asObject(response.json)?.message;
  const message = typeof messageValue === "string" ? ` ${messageValue}` : "";
  return `${what}: HTTP ${response.status || "no response"}${message}${response.error ? ` (${response.error})` : ""}`;
}

export function githubRequest(
  config: GitHubApiConfig,
  request: CurlRequest,
): ApiResponse {
  let tmp: string | undefined;
  let bodyFile: string | undefined;
  if (request.body !== undefined) {
    tmp = mkdtempSync(join(tmpdir(), "surffish-gh-"));
    bodyFile = join(tmp, "body.json");
    writeFileSync(bodyFile, JSON.stringify(request.body));
  }
  try {
    const result = spawnSync("curl", curlArgs(config, request, bodyFile), {
      input: curlAuthConfig(config.token),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const { status, json } = parseCurlOutput(result.stdout ?? "");
    const error = status
      ? undefined
      : (result.stderr ?? "").trim().slice(0, 300) ||
        `curl exited ${result.status ?? result.signal}`;
    return { status, json, error };
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

const api = (config: GitHubApiConfig, path: string): string =>
  `${config.api ?? DEFAULT_API}/repos/${config.repo}${path}`;

/** Read-only connectivity + auth check (what a dry run proves): the repo and its releases list. */
export function checkGitHubApi(config: GitHubApiConfig): string[] {
  const lines: string[] = [];
  const repo = githubRequest(config, {
    method: "GET",
    url: api(config, ""),
    maxTimeSeconds: 30,
  });
  if (repo.status !== 200)
    throw new Error(describeFailure(`GET /repos/${config.repo}`, repo));
  lines.push(`GET /repos/${config.repo}: HTTP 200`);
  const releases = githubRequest(config, {
    method: "GET",
    url: api(config, "/releases?per_page=5"),
    maxTimeSeconds: 30,
  });
  if (releases.status !== 200)
    throw new Error(
      describeFailure(`GET /repos/${config.repo}/releases`, releases),
    );
  const latest = Array.isArray(releases.json)
    ? releases.json
        .map((release) => asObject(release)?.tag_name)
        .filter((tag): tag is string => typeof tag === "string")
        .join(", ")
    : "";
  lines.push(
    `GET /repos/${config.repo}/releases: HTTP 200 (${latest || "none"})`,
  );
  return lines;
}

export interface CreateReleaseInput {
  tag: string;
  title: string;
  notes: string;
  assetPath: string;
  log?: (message: string) => void;
  /** Mark the release as a pre-release (for tags like vX.Y.Z-beta.N). */
  prerelease?: boolean;
}

/**
 * `gh release create TAG ASSET --title --notes-file --verify-tag`, resumable: the tag must exist on
 * GitHub; an existing release for the tag (draft or not) is reused; an asset that's already
 * uploaded isn't uploaded again. Created as a draft, then published once the asset is up.
 */
export function createGitHubRelease(
  config: GitHubApiConfig,
  input: CreateReleaseInput,
): { url: string; assets: string[] } {
  const log = input.log ?? (() => {});
  const ref = githubRequest(config, {
    method: "GET",
    url: api(config, `/git/ref/tags/${encodeURIComponent(input.tag)}`),
    maxTimeSeconds: 30,
  });
  if (ref.status !== 200)
    throw new Error(
      describeFailure(
        `tag ${input.tag} not found on GitHub (GET git/ref/tags)`,
        ref,
      ),
    );

  const list = githubRequest(config, {
    method: "GET",
    url: api(config, "/releases?per_page=100"),
    maxTimeSeconds: 30,
  });
  if (list.status !== 200)
    throw new Error(describeFailure("listing releases", list));
  let release: Release | undefined = findReleaseByTag<Release>(
    list.json,
    input.tag,
  );
  if (release) {
    log(
      `reusing the existing ${release.draft ? "draft " : ""}release for ${input.tag} (id ${release.id})`,
    );
  } else {
    const created = githubRequest(config, {
      method: "POST",
      url: api(config, "/releases"),
      body: {
        tag_name: input.tag,
        name: input.title,
        body: input.notes,
        draft: true,
        prerelease: input.prerelease ?? false,
      },
    });
    if (created.status !== 201)
      throw new Error(
        describeFailure(`creating the ${input.tag} release`, created),
      );
    release = asObject(created.json) as Release | undefined;
    if (!release)
      throw new Error(
        `creating the ${input.tag} release returned invalid JSON`,
      );
    log(`created draft release ${input.tag} (id ${release.id})`);
  }

  const name = basename(input.assetPath);
  const existing = (release.assets ?? []).find((asset) => asset.name === name);
  if (existing && existing.state === "uploaded") {
    log(`${name} is already on the release, not uploading again`);
  } else if (existing) {
    throw new Error(
      `${name} is on the release in state "${existing.state}"; delete that asset on GitHub, then run --resume`,
    );
  } else {
    log(`uploading ${name}…`);
    const upload = githubRequest(config, {
      method: "POST",
      url: releaseAssetUploadUrl(
        config.uploads ?? DEFAULT_UPLOADS,
        config.repo,
        release.id,
        name,
      ),
      uploadFile: input.assetPath,
      contentType: "application/zip",
      maxTimeSeconds: 1800,
    });
    if (upload.status !== 201)
      throw new Error(describeFailure(`uploading ${name}`, upload));
    const size = asObject(upload.json)?.size ?? "?";
    log(`uploaded ${name} (${size} bytes)`);
  }

  let published: Release = release;
  if (release.draft) {
    const patch = githubRequest(config, {
      method: "PATCH",
      url: api(config, `/releases/${release.id}`),
      body: input.prerelease
        ? { draft: false, prerelease: true }
        : { draft: false, make_latest: "true" },
    });
    if (patch.status !== 200)
      throw new Error(
        describeFailure(`publishing the ${input.tag} release`, patch),
      );
    published = (asObject(patch.json) as Release | undefined) ?? published;
  }
  const final = githubRequest(config, {
    method: "GET",
    url: api(config, `/releases/${release.id}`),
    maxTimeSeconds: 30,
  });
  const assets =
    final.status === 200
      ? ((asObject(final.json)?.assets as ReleaseAsset[] | undefined) ?? [])
          .map((asset) => asset.name)
          .filter(
            (assetName): assetName is string => typeof assetName === "string",
          )
      : [name];
  return {
    url:
      published?.html_url ??
      `https://github.com/${config.repo}/releases/tag/${input.tag}`,
    assets,
  };
}
