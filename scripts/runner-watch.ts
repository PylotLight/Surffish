#!/usr/bin/env bun
/**
 * Says why a job failed, right in the self-hosted runner's terminal.
 *
 *   ./run.sh 2>&1 | bun /path/to/Surffish/scripts/runner-watch.ts      (fish: ./run.sh &| bun …)
 *
 * Every line of the runner's output is passed through unchanged. After a line like
 * `Job Surffish · Release · mac build · patch completed with result: Failed` it looks that job up on
 * GitHub (the latest failed job with that name across the owner's repos) and prints
 * `  ↳ why: <first error annotation>`, e.g. the one scripts/ci/failure-reason.ts adds.
 *
 * Dependency-free. GitHub calls go through curl (so a socks5h:// proxy works) with SURFFISH_GH_PROXY
 * as the proxy when set, and GH_TOKEN / GITHUB_TOKEN / `gh auth token` for auth (unauthenticated
 * works for public repos). It never blocks or kills the pipe: lookups run in the background and any
 * error turns into a short `↳ why: (lookup failed: …)` line. Ctrl-C is left to the runner; this exits
 * when the runner's output ends.
 *
 * Env: RUNNER_WATCH_OWNER (default PylotLight), RUNNER_WATCH_REPOS (comma list, default: the owner's
 * 15 most recently pushed repos), SURFFISH_GH_PROXY, GH_TOKEN / GITHUB_TOKEN.
 */
import { spawn, spawnSync } from "node:child_process";

const COMPLETED = /Job (.+?) completed with result: (\w+)/;

/** The job name from a runner "completed" line when it failed, else null. */
export function failedJobName(line: string): string | null {
  const match = line.match(COMPLETED);
  if (!match || match[2]?.toLowerCase() !== "failed") return null;
  return match[1]?.trim() || null;
}

export interface Annotation {
  annotation_level?: string;
  title?: string | null;
  message?: string | null;
}

function isAnnotation(value: unknown): value is Annotation {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.annotation_level === undefined ||
      typeof candidate.annotation_level === "string") &&
    (candidate.title === undefined ||
      candidate.title === null ||
      typeof candidate.title === "string") &&
    (candidate.message === undefined ||
      candidate.message === null ||
      typeof candidate.message === "string")
  );
}

export interface JobStep {
  name: string;
  conclusion?: string | null;
}

const GENERIC =
  /^(?:Process completed with exit code \d+\.?|The process '.*' failed with exit code \d+)$/;

/** The line to print for a failed job: our step annotation first, then any error, then the failed step. */
export function pickReason(
  annotations: Annotation[],
  steps: JobStep[] = [],
): string | null {
  const failures = annotations.filter(
    (a) => (a.annotation_level ?? "failure") === "failure" && a.message?.trim(),
  );
  const firstLine = (a: Annotation): string =>
    ((a.message ?? "").trim().split("\n")[0] ?? "").trim();
  const specific = failures.find((a) => !GENERIC.test(firstLine(a)));
  if (specific) {
    const message = firstLine(specific);
    const title = specific.title?.trim();
    return title && !message.toLowerCase().startsWith(title.toLowerCase())
      ? `${title}: ${message}`
      : message;
  }
  const step = steps.find((s) => s.conclusion === "failure");
  const generic = failures[0] ? firstLine(failures[0]) : null;
  if (step)
    return `step "${step.name}" failed${generic ? ` (${generic.replace(/\.$/, "").replace(/^Process completed with /, "")})` : ""}`;
  return generic;
}

// ---- GitHub lookups (curl) ---------------------------------------------------

let cachedToken: string | null | undefined;
function token(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken =
    (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "").trim() || null;
  if (!cachedToken) {
    try {
      const out = spawnSync("gh", ["auth", "token"], {
        encoding: "utf8",
        timeout: 5000,
      });
      if (out.status === 0 && out.stdout.trim())
        cachedToken = out.stdout.trim();
    } catch {
      /* no gh */
    }
  }
  return cachedToken;
}

function api(path: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sS",
      "--max-time",
      "20",
      "-H",
      "Accept: application/vnd.github+json",
      "-H",
      "X-GitHub-Api-Version: 2022-11-28",
      "-w",
      "\n%{http_code}",
      "--config",
      "-",
    ];
    const proxy = process.env.SURFFISH_GH_PROXY?.trim();
    if (proxy) args.push("--proxy", proxy);
    args.push(`https://api.github.com${path}`);
    let child;
    try {
      child = spawn("curl", args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      return reject(error);
    }
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d;
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", () => {
      const cut = out.lastIndexOf("\n");
      const status = Number(out.slice(cut + 1)) || 0;
      if (status < 200 || status >= 300)
        return reject(
          new Error(
            status
              ? `HTTP ${status} ${path.split("?")[0]}`
              : err.trim().split("\n").at(-1) || "curl failed",
          ),
        );
      try {
        resolve(JSON.parse(out.slice(0, cut)));
      } catch {
        reject(new Error("bad JSON"));
      }
    });
    const t = token();
    child.stdin.on("error", () => {});
    child.stdin.end(
      t && !/["\\\r\n]/.test(t)
        ? `header = "Authorization: Bearer ${t}"\n`
        : "",
    );
  });
}

async function repos(owner: string): Promise<string[]> {
  const fixed = process.env.RUNNER_WATCH_REPOS?.split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  if (fixed?.length)
    return fixed.map((r) => (r.includes("/") ? r : `${owner}/${r}`));
  const response = token()
    ? await api("/user/repos?affiliation=owner&sort=pushed&per_page=15").catch(
        () => api(`/users/${owner}/repos?sort=pushed&per_page=15`),
      )
    : await api(`/users/${owner}/repos?sort=pushed&per_page=15`);
  const list = Array.isArray(response) ? (response as RepoRecord[]) : [];
  return list
    .filter(
      (r): r is RepoRecord & { full_name: string } =>
        r.owner?.login?.toLowerCase() === owner.toLowerCase() &&
        typeof r.full_name === "string",
    )
    .map((r) => r.full_name);
}

interface RepoRecord {
  owner?: { login?: string };
  full_name?: string;
}
interface WorkflowRun {
  id: number;
}
interface WorkflowRuns {
  workflow_runs?: WorkflowRun[];
}
interface WorkflowJob extends JobStep {
  id: number;
  name: string;
  conclusion?: string | null;
  html_url: string;
  completed_at?: string | null;
  steps?: JobStep[];
}
interface WorkflowJobs {
  jobs?: WorkflowJob[];
}
interface FoundJob {
  repo: string;
  id: number;
  url: string;
  completedAt: string;
  steps: JobStep[];
}

async function findFailedJob(
  name: string,
  owner: string,
): Promise<FoundJob | null> {
  const since =
    new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 19) + "Z";
  const perRepo = await Promise.all(
    (await repos(owner)).map(async (repo) => {
      try {
        const runs = (await api(
          `/repos/${repo}/actions/runs?status=failure&per_page=5&created=%3E%3D${since}`,
        )) as WorkflowRuns;
        const jobs = await Promise.all(
          (runs.workflow_runs ?? []).map((run) =>
            api(
              `/repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
            ).then(
              (j) => (j as WorkflowJobs).jobs ?? [],
              () => [],
            ),
          ),
        );
        return jobs
          .flat()
          .filter((job) => job.name === name && job.conclusion === "failure")
          .map((job): FoundJob => ({
            repo,
            id: job.id,
            url: job.html_url,
            completedAt: job.completed_at ?? "",
            steps: job.steps ?? [],
          }));
      } catch {
        return [];
      }
    }),
  );
  return (
    perRepo
      .flat()
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))[0] ?? null
  );
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function explain(name: string): Promise<string> {
  const owner = process.env.RUNNER_WATCH_OWNER || "PylotLight";
  let lastError = "no failed job with that name yet";
  // GitHub marks the job failed a few seconds after the runner prints it
  for (const wait of [3000, 7000, 15000, 30000]) {
    await sleep(wait);
    try {
      const job = await findFailedJob(name, owner);
      if (!job) continue;
      const annotationResponse = await api(
        `/repos/${job.repo}/check-runs/${job.id}/annotations?per_page=50`,
      ).catch(() => []);
      const annotations = Array.isArray(annotationResponse)
        ? annotationResponse.filter(isAnnotation)
        : [];
      const reason = pickReason(annotations, job.steps);
      if (reason) return `${reason}  ${job.url}`;
      lastError = "job found, no annotations yet";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return `(lookup failed: ${lastError})`;
}

// ---- the pipe ----------------------------------------------------------------

function write(text: string): void {
  try {
    process.stdout.write(text);
  } catch {
    /* stdout gone: keep draining stdin */
  }
}

function main(): void {
  process.on("SIGINT", () => {}); // the runner gets Ctrl-C and shuts down; we exit at its EOF
  process.on("uncaughtException", () => {});
  process.on("unhandledRejection", () => {});
  process.stdout.on("error", () => {});
  const pending = new Set<Promise<void>>();
  let partial = "";
  process.stdin.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    write(text);
    partial += text;
    const lines = partial.split("\n");
    partial = lines.pop() ?? "";
    if (partial.length > 65536) partial = "";
    for (const line of lines) {
      const name = failedJobName(line);
      if (!name) continue;
      const p: Promise<void> = explain(name)
        .then(
          (why) => write(`  ↳ why: ${why}\n`),
          () => {},
        )
        .finally(() => pending.delete(p));
      pending.add(p);
    }
  });
  process.stdin.on("end", async () => {
    const deadline = sleep(60_000);
    await Promise.race([Promise.allSettled([...pending]), deadline]);
    process.exit(0);
  });
}

if (import.meta.main) main();
