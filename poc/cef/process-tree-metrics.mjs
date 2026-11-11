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
  { startedAtNs = process.hrtime.bigint(), intervalMs = 125 } = {},
) {
  const samples = [];
  const events = [];
  const previousCpuTicks = new Map();
  let cumulativeCpuTicks = 0;
  let timer;
  let stopped = false;

  const sample = () => {
    const now = process.hrtime.bigint();
    const rows = processTree(rootPid);
    const present = new Set();
    for (const row of rows) {
      present.add(row.pid);
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
      cpuTicks: cumulativeCpuTicks,
      processCount: rows.length,
    });
  };

  sample();
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
      sample();
    }
    const byName = (name) =>
      events.find((event) => event.phase === name)?.timeNs;
    const latestNs = samples.at(-1)?.timeNs ?? process.hrtime.bigint();
    const readyNs = byName("ready");
    const idleStartNs = byName("idle-start");
    const idleEndNs = byName("idle-end");
    const activeStartNs = byName("active-start");
    const activeEndNs = byName("active-end");
    return {
      samplingIntervalMs: intervalMs,
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
      maxProcessCount: samples.length
        ? Math.max(...samples.map((entry) => entry.processCount))
        : null,
      phases: events.map(({ phase, elapsedMs }) => ({ phase, elapsedMs })),
    };
  };

  return { mark, finish };
}
