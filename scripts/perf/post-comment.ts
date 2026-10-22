#!/usr/bin/env bun
// Creates or updates one sticky PR comment, found by a hidden marker, with curl.
//   bun scripts/perf/post-comment.ts <marker> <markdown file>
// Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, GITHUB_API_URL (optional),
//      GH_PROXY (optional, e.g. socks5h://127.0.0.1:1080: passed to curl --proxy for these calls only).
// Never fails the job: problems are printed as ::warning:: and the exit code is 0.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [marker, file] = process.argv.slice(2);
const {
  GITHUB_TOKEN: token,
  GITHUB_REPOSITORY: repo,
  PR_NUMBER: pr,
  GH_PROXY: proxy,
} = process.env;
const api = process.env.GITHUB_API_URL || "https://api.github.com";
const warn = (m: string) => {
  console.log(`::warning::perf comment not posted: ${m}`);
  process.exit(0);
};
if (!marker || !file) warn("usage: post-comment.ts <marker> <file>");
if (!token || !repo || !pr)
  warn("GITHUB_TOKEN, GITHUB_REPOSITORY or PR_NUMBER missing");

function curl(
  method: string,
  url: string,
  body?: unknown,
): { status: number; json: any } {
  const args = [
    "-sS",
    "--max-time",
    "30",
    "-X",
    method,
    "-o",
    "-",
    "-w",
    "\n%{http_code}",
    "-H",
    "Accept: application/vnd.github+json",
    "-H",
    "X-GitHub-Api-Version: 2022-11-28",
    "-H",
    `Authorization: Bearer ${token}`,
  ];
  if (proxy) args.push("--proxy", proxy);
  if (body !== undefined)
    args.push("-H", "Content-Type: application/json", "--data-binary", "@-");
  const r = spawnSync("curl", [...args, url], {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
  });
  const out = r.stdout ?? "";
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1)) || 0;
  let json: any = null;
  try {
    json = JSON.parse(out.slice(0, cut));
  } catch {
    /* not JSON */
  }
  if (!status)
    console.log(
      `curl ${method} failed: ${(r.stderr ?? "").trim().slice(0, 200)}`,
    );
  return { status, json };
}

const tag = `<!-- surffish-perf:${marker} -->`;
const body = `${tag}\n${readFileSync(file!, "utf8")}`;
let existing: number | undefined;
for (let page = 1; page <= 5 && existing === undefined; page++) {
  const r = curl(
    "GET",
    `${api}/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`,
  );
  if (r.status !== 200 || !Array.isArray(r.json))
    warn(`listing comments returned HTTP ${r.status}`);
  existing = r.json.find(
    (c: any) => typeof c.body === "string" && c.body.startsWith(tag),
  )?.id;
  if (r.json.length < 100) break;
}
const r = existing
  ? curl("PATCH", `${api}/repos/${repo}/issues/comments/${existing}`, { body })
  : curl("POST", `${api}/repos/${repo}/issues/${pr}/comments`, { body });
if (r.status !== 200 && r.status !== 201)
  warn(
    `${existing ? "update" : "create"} returned HTTP ${r.status} ${r.json?.message ?? ""}`,
  );
console.log(
  `perf comment ${existing ? "updated" : "created"}: ${r.json?.html_url ?? ""}`,
);
