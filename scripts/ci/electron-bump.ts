// Picks the Electron version main should be pinned to, for .github/workflows/electron-bump.yml.
// Policies (ELECTRON_BUMP_POLICY, or the workflow_dispatch `policy` input):
//   beta    (default) newest of the current major and anything newer, betas and stables alike: follows
//           the current major's betas to its stable release, takes its stable patches, and moves to the
//           next major's beta.1 as soon as it is published (so main always runs the newest Electron).
//   stable-after-ga   like beta until the current major is stable, then only that major's stable patches
//           (moves to the next major only once it is stable too).
//   stable  only stable releases: newest patch of the current major (newest stable major if the
//           current pin is a pre-release of a major with no stable yet: stays put).
// Alphas and nightlies are never picked.
type Policy = "beta" | "stable-after-ga" | "stable";
const POLICIES: readonly Policy[] = ["beta", "stable-after-ga", "stable"];

interface V {
  major: number;
  minor: number;
  patch: number;
  beta: number | null;
  raw: string;
}

function parse(raw: string): V | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/.exec(raw.trim());
  if (!m) return null;
  return {
    major: +m[1]!,
    minor: +m[2]!,
    patch: +m[3]!,
    beta: m[4] === undefined ? null : +m[4],
    raw: raw.trim(),
  };
}

function compare(a: V, b: V): number {
  return (
    a.major - b.major ||
    a.minor - b.minor ||
    a.patch - b.patch ||
    // a stable x.y.z is newer than any x.y.z-beta.N
    (a.beta === b.beta
      ? 0
      : a.beta === null
        ? 1
        : b.beta === null
          ? -1
          : a.beta - b.beta)
  );
}

/** The version to pin, or null when the current pin is already the policy's choice. */
export function pickTarget(
  current: string,
  published: readonly string[],
  policy: Policy,
): string | null {
  const cur = parse(current);
  if (!cur)
    throw new Error(
      `current electron pin "${current}" is not an exact x.y.z or x.y.z-beta.N`,
    );
  const all = published
    .map(parse)
    .filter((v): v is V => v !== null)
    .sort(compare);
  const stableOf = (major: number) =>
    all.filter((v) => v.major === major && v.beta === null);
  let pool: V[];
  if (policy === "beta") {
    pool = all.filter((v) => v.major >= cur.major);
  } else if (policy === "stable-after-ga") {
    const curMajorIsGa = stableOf(cur.major).length > 0;
    pool = curMajorIsGa
      ? all.filter((v) => v.beta === null && v.major >= cur.major)
      : all.filter((v) => v.major === cur.major);
  } else {
    pool = all.filter((v) => v.beta === null && v.major >= cur.major);
  }
  const best = pool.at(-1);
  if (!best || compare(best, cur) <= 0) return null;
  return best.raw;
}

if (import.meta.main) {
  const policy = (process.env.ELECTRON_BUMP_POLICY || "beta") as Policy;
  if (!POLICIES.includes(policy))
    throw new Error(
      `unknown ELECTRON_BUMP_POLICY "${policy}" (one of ${POLICIES.join(", ")})`,
    );
  const pkg = await Bun.file("package.json").json();
  const current: string = pkg.devDependencies?.electron;
  const override = (process.env.ELECTRON_BUMP_VERSION || "").trim();
  let target: string | null;
  if (override) {
    if (!parse(override))
      throw new Error(
        `version "${override}" is not an exact x.y.z or x.y.z-beta.N`,
      );
    target = override === current ? null : override;
  } else {
    const res = await fetch("https://registry.npmjs.org/electron", {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) throw new Error(`npm registry: HTTP ${res.status}`);
    const doc = (await res.json()) as {
      versions: Record<string, unknown>;
      "dist-tags": Record<string, string>;
    };
    console.error(
      `dist-tags: beta=${doc["dist-tags"].beta} latest=${doc["dist-tags"].latest}`,
    );
    target = pickTarget(current, Object.keys(doc.versions), policy);
  }
  console.error(
    `policy=${policy} current=${current} target=${target ?? "(up to date)"}`,
  );
  console.log(JSON.stringify({ current, target, policy }));
}
