import { describe, expect, test } from "bun:test";
import {
  cleanLine,
  describeRoute,
  redactProxy,
  errorAnnotation,
  failureReason,
  lastErrorLine,
  summaryLine,
} from "./failure-reason.ts";
import { failedJobName, pickReason } from "../runner-watch.ts";

// tail of the v0.1.29 release run 39456671479 (runner restarted without HTTP(S)_PROXY)
const PUSH_403 = [
  "Wed 2026-10-21 3:21 AM AEDT (UTC+11:00) \x1b[36m[release]\x1b[0m Surffish-0.1.29-mac-arm64.zip",
  "remote: Permission to PylotLight/Surffish.git denied to github-actions[bot].",
  "fatal: unable to access 'https://github.com/PylotLight/Surffish.git/': The requested URL returned error: 403",
  "\x1b[31m[release] error:\x1b[0m git push --quiet origin main exited 128",
].join("\n");

describe("failureReason", () => {
  test("push 403 without a proxy says the runner is not behind the proxy", () => {
    const reason = failureReason(PUSH_403, {});
    expect(reason).toStartWith("push to GitHub 403: runner not behind proxy");
    expect(reason).toContain(
      "SURFFISH_GH_PROXY / HTTPS_PROXY in the runner .env",
    );
  });

  test("push 403 through a proxy points at the token / proxy instead", () => {
    const reason = failureReason(PUSH_403, {
      SURFFISH_GH_PROXY: "socks5h://127.0.0.1:1080",
    });
    expect(reason).toStartWith(
      "push to GitHub 403 even via SURFFISH_GH_PROXY socks5h://127.0.0.1:1080",
    );
  });

  test('preflight dry-run 403 (no "git push" in the log) still maps', () => {
    expect(
      failureReason(
        "fatal: unable to access 'https://github.com/PylotLight/Surffish.git/': The requested URL returned error: 403",
        {},
      ),
    ).toStartWith("git to GitHub 403: runner not behind proxy");
  });

  test("dead SOCKS tunnel", () => {
    const log =
      "fatal: unable to access 'https://github.com/PylotLight/Surffish.git/': Failed to connect to 127.0.0.1 port 1080 after 0 ms: Couldn't connect to server";
    expect(
      failureReason(log, { SURFFISH_GH_PROXY: "socks5h://127.0.0.1:1080" }),
    ).toBe(
      "GitHub proxy unreachable (via SURFFISH_GH_PROXY socks5h://127.0.0.1:1080): is the SOCKS tunnel on the Mac up?",
    );
    expect(
      failureReason(
        "curl: (97) Can't complete SOCKS5 connection to github.com. (1)",
        {},
      ),
    ).toStartWith("GitHub proxy unreachable");
  });

  test("DNS", () => {
    expect(
      failureReason(
        "fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com",
        {},
      ),
    ).toBe(
      "DNS: can't resolve github.com from the runner (network down / VPN?)",
    );
  });

  test("release script errors", () => {
    expect(
      failureReason(
        "[release] error: v0.1.29 already exists on origin (finish it with --resume)",
      ),
    ).toBe("v0.1.29 is already tagged on origin: finish it with resume=true");
    expect(
      failureReason(
        "[release] wrote a draft at docs/releases/v0.1.30.md — tidy it up",
      ),
    ).toBe(
      "release notes missing: commit docs/releases/v0.1.30.md to main first",
    );
    expect(
      failureReason(
        "[release] error: github release: HTTP 422 Validation Failed — fix it, then run with --resume",
      ),
    ).toBe(
      "creating the GitHub release failed: HTTP 422 Validation Failed (re-run with resume=true)",
    );
    expect(failureReason("[release] error: zip integrity failed")).toStartWith(
      "app zip broken or missing",
    );
  });

  test("tests and typecheck", () => {
    expect(
      failureReason(
        "(pass) a [0.1ms]\n(fail) pinned reorder > keeps order [1.20ms]\n[release] error: tests failed",
      ),
    ).toBe("unit test failed: pinned reorder > keeps order");
    expect(
      failureReason(
        "src/a.ts(3,1): error TS2322: Type 'x' is not assignable\n[release] error: typecheck failed",
      ),
    ).toBe("typecheck: error TS2322: Type 'x' is not assignable");
  });

  test("notarization and npm", () => {
    expect(
      failureReason(
        "  • notarization failed: The software asset has an invalid signature",
      ),
    ).toStartWith("notarization failed:");
    expect(
      failureReason(
        "npm error code E403\nnpm error 403 Forbidden - PUT https://registry.npmjs.org/@pylotlight%2fsurffish",
      ),
    ).toBe(
      "npm E403: 403 Forbidden - PUT https://registry.npmjs.org/@pylotlight%2fsurffish",
    );
    expect(
      failureReason(
        "npm ERR! need auth This command requires you to be logged in.",
      ),
    ).toBe("npm: need auth This command requires you to be logged in.");
  });

  test("runner went away", () => {
    expect(
      failureReason(
        "The self-hosted runner: mac lost communication with the server.",
      ),
    ).toBe("Mac runner went offline / lost its connection mid-job");
  });

  test("generic fallback = last error line, timestamps + colours stripped, exit noise skipped", () => {
    const log =
      "Wed 2026-10-21 3:19 AM AEDT (UTC+11:00) building\nWed 2026-10-21 3:19 AM AEDT (UTC+11:00) \x1b[31mboom: something failed here\x1b[0m\nProcess completed with exit code 1.";
    expect(failureReason(log)).toBe("boom: something failed here");
    expect(failureReason("just some output\nlast line")).toBe("last line");
    expect(failureReason("", {}, 2)).toBe("exited 2 (no output)");
    expect(lastErrorLine(["", "  "])).toBeNull();
  });

  test("long reasons are cut to one short line", () => {
    expect(
      failureReason(`error: ${"x".repeat(500)}`).length,
    ).toBeLessThanOrEqual(220);
  });
});

describe("helpers", () => {
  test("describeRoute", () => {
    expect(describeRoute({})).toBe("direct (no proxy)");
    expect(describeRoute({ HTTPS_PROXY: "socks5://127.0.0.1:1080" })).toBe(
      "via HTTPS_PROXY socks5://127.0.0.1:1080",
    );
    expect(
      describeRoute({ HTTPS_PROXY: "a", SURFFISH_GH_PROXY: "socks5h://b" }),
    ).toBe("via SURFFISH_GH_PROXY socks5h://b");
    expect(
      describeRoute({ HTTPS_PROXY: "http://user:s3cret@proxy:8080" }),
    ).toBe("via HTTPS_PROXY http://***@proxy:8080");
    expect(redactProxy("socks5h://127.0.0.1:1080")).toBe(
      "socks5h://127.0.0.1:1080",
    );
  });

  test("cleanLine", () => {
    expect(
      cleanLine("2026-10-21T03:21:55.1234Z ##[error]\x1b[31mnope\x1b[0m"),
    ).toBe("nope");
  });

  test("errorAnnotation escapes workflow-command characters", () => {
    expect(errorAnnotation("bun run release", "push 403: a, b\nc 100%")).toBe(
      "::error title=bun run release::push 403: a, b%0Ac 100%25",
    );
    expect(errorAnnotation("step: x, y", "r")).toBe(
      "::error title=step%3A x%2C y::r",
    );
    expect(summaryLine("**bold**", "why")).toBe("- ❌ **bold**: why\n");
  });
});

describe("runner-watch", () => {
  test("failedJobName reads the runner terminal line", () => {
    expect(
      failedJobName(
        "2026-10-20 16:21:58Z: Job Surffish · Release · mac build · patch completed with result: Failed",
      ),
    ).toBe("Surffish · Release · mac build · patch");
    expect(
      failedJobName(
        "2026-10-20 16:21:58Z: Job mac completed with result: Succeeded",
      ),
    ).toBeNull();
    expect(failedJobName("2026-10-20 16:19:02Z: Running job: mac")).toBeNull();
  });

  test("pickReason prefers our titled annotation over the generic exit code", () => {
    const annotations = [
      {
        annotation_level: "failure",
        title: "",
        message: "Process completed with exit code 1.",
      },
      { annotation_level: "warning", message: "npm publish skipped" },
      {
        annotation_level: "failure",
        title: "bun run release",
        message: "push to GitHub 403: runner not behind proxy",
      },
    ];
    expect(pickReason(annotations)).toBe(
      "bun run release: push to GitHub 403: runner not behind proxy",
    );
  });

  test("pickReason falls back to the failed step", () => {
    expect(
      pickReason(
        [
          {
            annotation_level: "failure",
            message: "Process completed with exit code 1.",
          },
        ],
        [
          { name: "Checkout", conclusion: "success" },
          { name: "bun run release", conclusion: "failure" },
        ],
      ),
    ).toBe('step "bun run release" failed (exit code 1)');
    expect(pickReason([], [])).toBeNull();
    expect(
      pickReason([
        {
          annotation_level: "failure",
          message: "Process completed with exit code 1.",
        },
      ]),
    ).toBe("Process completed with exit code 1.");
  });
});
