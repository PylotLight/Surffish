import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { availableParallelism } from "node:os";

const HZ =
  Number(
    spawnSync("getconf", ["CLK_TCK"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).stdout.trim(),
  ) || 100;
const CPU_COUNT = availableParallelism();
const MIB = 1024 * 1024;
const CGROUP_PATH = (() => {
  try {
    const entry = readFileSync(`/proc/${process.pid}/cgroup`, "utf8")
      .split("\n")
      .find((line) => line.startsWith("0::"));
    return entry ? entry.slice(3) : null;
  } catch {
    return null;
  }
})();
const CGROUP_DIR = CGROUP_PATH ? `/sys/fs/cgroup${CGROUP_PATH}` : null;

function readPssKb(pid) {
  try {
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const match = /^Pss:\s+(\d+)\s+kB$/m.exec(text);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function readCgroupValue(name) {
  if (!CGROUP_DIR) return null;
  try {
    const value = readFileSync(`${CGROUP_DIR}/${name}`, "utf8").trim();
    return value === "max" ? null : Number(value);
  } catch {
    return null;
  }
}

function processTree(rootPid) {
  const result = spawnSync("ps", ["-eo", "pid=,ppid=,rss="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return [];

  const processes = result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter((row) => row.length === 3 && row.every(Number.isFinite))
    .map(([pid, ppid, rssKb]) => ({ pid, ppid, rssKb }));
  const tree = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const process of processes) {
      if (tree.has(process.ppid) && !tree.has(process.pid)) {
        tree.add(process.pid);
        changed = true;
      }
    }
  }
  return processes.filter((process) => tree.has(process.pid));
}

function cpuTicks(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closeParen = stat.lastIndexOf(")");
    const fields = stat
      .slice(closeParen + 2)
      .trim()
      .split(/\s+/);
    return Number(fields[11]) + Number(fields[12]);
  } catch {
    return null;
  }
}

function round(value, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function createProcessTreeMetrics(
  rootPid,
  {
    startedAtNs = process.hrtime.bigint(),
    intervalMs = 125,
    pssIntervalMs = 500,
  } = {},
) {
  if (!Number.isSafeInteger(pssIntervalMs) || pssIntervalMs < 0) {
    throw new Error("pssIntervalMs must be a nonnegative safe integer.");
  }
  const pssIntervalNs = pssIntervalMs
    ? BigInt(pssIntervalMs) * 1_000_000n
    : null;
  const samples = [];
  const events = [];
  const previousCpuTicks = new Map();
  let cumulativeCpuTicks = 0;
  let lastPssAtNs = 0n;
  let timer;
  let stopped = false;

  const sample = (forcePss = false) => {
    const now = process.hrtime.bigint();
    const rows = processTree(rootPid);
    const present = new Set();
    const samplePss = Boolean(
      pssIntervalNs &&
      (forcePss || lastPssAtNs === 0n || now - lastPssAtNs >= pssIntervalNs),
    );
    let pssKb = 0;
    let pssProcessCount = 0;
    for (const row of rows) {
      present.add(row.pid);
      if (samplePss) {
        const pss = readPssKb(row.pid);
        if (pss !== null) {
          pssKb += pss;
          pssProcessCount += 1;
        }
      }
      const ticks = cpuTicks(row.pid);
      if (ticks === null) continue;
      const previous = previousCpuTicks.get(row.pid);
      if (previous !== undefined && ticks >= previous) {
        cumulativeCpuTicks += ticks - previous;
      }
      previousCpuTicks.set(row.pid, ticks);
    }
    for (const pid of previousCpuTicks.keys()) {
      if (!present.has(pid)) previousCpuTicks.delete(pid);
    }
    samples.push({
      timeNs: now,
      elapsedMs: Number(now - startedAtNs) / 1e6,
      rssKb: rows.reduce((sum, row) => sum + row.rssKb, 0),
      pssKb: samplePss && pssProcessCount ? pssKb : null,
      pssProcessCount: samplePss ? pssProcessCount : 0,
      pssSampled: samplePss,
      cgroupCurrentBytes: readCgroupValue("memory.current"),
      cpuTicks: cumulativeCpuTicks,
      processCount: rows.length,
    });
    if (samplePss) lastPssAtNs = now;
  };

  sample(true);
  timer = setInterval(sample, intervalMs);
  timer.unref();

  const mark = (phase) => {
    const timeNs = process.hrtime.bigint();
    const event = {
      phase,
      elapsedMs: round(Number(timeNs - startedAtNs) / 1e6, 1),
    };
    events.push({ ...event, timeNs });
    return event;
  };

  const summarizeRange = (startNs, endNs) => {
    if (startNs === undefined || endNs === undefined || endNs <= startNs) {
      return null;
    }
    const durationMs = Number(endNs - startNs) / 1e6;
    const selected = samples.filter(
      (entry) => entry.timeNs >= startNs && entry.timeNs <= endNs,
    );
    let cpu = 0;
    for (let index = 1; index < samples.length; index += 1) {
      const before = samples[index - 1];
      const after = samples[index];
      if (
        !before ||
        !after ||
        after.timeNs <= startNs ||
        before.timeNs >= endNs
      ) {
        continue;
      }
      const sampleDurationNs = after.timeNs - before.timeNs;
      const overlapStart = before.timeNs < startNs ? startNs : before.timeNs;
      const overlapEnd = after.timeNs > endNs ? endNs : after.timeNs;
      const overlapNs = overlapEnd - overlapStart;
      const tickDelta = Math.max(0, after.cpuTicks - before.cpuTicks);
      if (sampleDurationNs > 0 && overlapNs > 0) {
        cpu += (tickDelta * Number(overlapNs)) / Number(sampleDurationNs);
      }
    }
    const cpuMs = (cpu / HZ) * 1000;
    const rssValues = selected.map((entry) => entry.rssKb / 1024);
    const pssValues = selected
      .filter((entry) => entry.pssSampled)
      .map((entry) => entry.pssKb)
      .filter(Number.isFinite)
      .map((value) => value / 1024);
    return {
      durationMs: round(durationMs),
      cpuMs: round(cpuMs),
      cpuPercentOfOneCore: round((cpuMs / durationMs) * 100),
      cpuPercentOfVisibleLogicalCpus: round(
        (cpuMs / (durationMs * CPU_COUNT)) * 100,
      ),
      meanRssMiB: rssValues.length
        ? round(
            rssValues.reduce((sum, value) => sum + value, 0) / rssValues.length,
          )
        : null,
      peakRssMiB: rssValues.length ? round(Math.max(...rssValues)) : null,
      meanPssMiB: pssValues.length
        ? round(
            pssValues.reduce((sum, value) => sum + value, 0) / pssValues.length,
          )
        : null,
      peakPssMiB: pssValues.length ? round(Math.max(...pssValues)) : null,
      pssSampleCount: pssValues.length,
      maxPssProcessCount: selected.length
        ? Math.max(...selected.map((entry) => entry.pssProcessCount))
        : null,
      maxProcessCount: selected.length
        ? Math.max(...selected.map((entry) => entry.processCount))
        : null,
      sampleCount: selected.length,
    };
  };

  const finish = () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
      sample(true);
    }
    const byName = (name) =>
      events.find((event) => event.phase === name)?.timeNs;
    const latestNs = samples.at(-1)?.timeNs ?? process.hrtime.bigint();
    const cgroupValues = samples
      .map((entry) => entry.cgroupCurrentBytes)
      .filter(Number.isFinite);
    const cgroupMiB = cgroupValues.map((value) => value / MIB);
    const cgroupMiddle = cgroupMiB.toSorted((a, b) => a - b);
    const cgroupMedian = cgroupMiddle.length
      ? cgroupMiddle[Math.floor(cgroupMiddle.length / 2)]
      : null;
    const readyNs = byName("ready");
    const idleStartNs = byName("idle-start");
    const idleEndNs = byName("idle-end");
    const activeStartNs = byName("active-start");
    const activeEndNs = byName("active-end");
    return {
      samplingIntervalMs: intervalMs,
      pssSamplingIntervalMs: pssIntervalNs ? pssIntervalMs : null,
      visibleLogicalCpus: CPU_COUNT,
      clockTicksPerSecond: HZ,
      coldStartupMs: readyNs
        ? round(Number(readyNs - startedAtNs) / 1e6)
        : null,
      coldStartup: readyNs ? summarizeRange(startedAtNs, readyNs) : null,
      idle: summarizeRange(idleStartNs, idleEndNs),
      active: summarizeRange(activeStartNs, activeEndNs),
      overall: summarizeRange(startedAtNs, latestNs),
      peakProcessTreeRssMiB: samples.length
        ? round(Math.max(...samples.map((entry) => entry.rssKb / 1024)))
        : null,
      peakProcessTreePssMiB: samples.some((entry) => entry.pssKb !== null)
        ? round(
            Math.max(
              ...samples
                .map((entry) => entry.pssKb)
                .filter(Number.isFinite)
                .map((value) => value / 1024),
            ),
          )
        : null,
      sharedCgroupMemory: {
        path: CGROUP_PATH,
        note: "memory.current is for the shared sandbox service cgroup, not attributable to this benchmark process tree",
        memoryMaxMiB:
          readCgroupValue("memory.max") === null
            ? null
            : round(readCgroupValue("memory.max") / MIB),
        currentStartMiB: cgroupMiB.length ? round(cgroupMiB[0]) : null,
        medianCurrentMiB: cgroupMedian === null ? null : round(cgroupMedian),
        peakObservedCurrentMiB: cgroupMiB.length
          ? round(Math.max(...cgroupMiB))
          : null,
        currentEndMiB: cgroupMiB.length ? round(cgroupMiB.at(-1)) : null,
        sampleCount: cgroupMiB.length,
      },
      maxProcessCount: samples.length
        ? Math.max(...samples.map((entry) => entry.processCount))
        : null,
      phases: events.map(({ phase, elapsedMs }) => ({ phase, elapsedMs })),
    };
  };

  return { mark, finish };
}
