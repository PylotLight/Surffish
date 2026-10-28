import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import {
  IDLE_READ_ALOUD_DOWNLOAD,
  READ_ALOUD_READY_FILE,
  type ReadAloudDownloadState,
} from "../shared/read-aloud";
import {
  isPhononRuntimeFile,
  type ReadAloudAsset,
  type ReadAloudManifest,
} from "../shared/read-aloud-assets";
import {
  parseVoiceCatalog,
  type CatalogVoiceFile,
} from "../shared/read-aloud-voices";
import { matchesIntegrity, readTarGz } from "./read-aloud-tar";

/**
 * Read Aloud's model download, Electron-free so it is unit tested (read-aloud-downloads.test.ts).
 *
 * One manager per app run. `ensureModel()` makes sure the Phonon runtime (the `phonon-tts` npm
 * tarball, unpacked) and the model files are in `<userData>/read-aloud`, checking what is already
 * there against the pinned hashes once per run (a match is kept, a mismatch is fetched again) and
 * downloading only what is missing, with progress. Concurrent callers share one download. The voice
 * catalog (voices.jsonl, ~33 KB, hash-checked and kept beside the model) is fetched by
 * `ensureCatalog()` once the model is there; a voice (~256 KB) by `ensureVoice()` when first used. `cancel()` aborts; completed files stay.
 * Nothing here deletes the folder except `deleteAll()` (Settings → Delete download).
 */

export interface ReadAloudDownloadDeps {
  directory: () => string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  manifest: () => ReadAloudManifest;
  onState: (state: ReadAloudDownloadState) => void;
  /** A reason network work is blocked right now (the proxy kill switch), or null. */
  blockedReason?: () => string | null;
  /** Progress updates at most this often (the last one always goes out). */
  progressIntervalMs?: number;
  timeoutMs?: number;
}

export class ReadAloudDownloadCancelled extends Error {
  constructor() {
    super("The voice model download was cancelled.");
    this.name = "ReadAloudDownloadCancelled";
  }
}

interface RuntimeMarker {
  integrity: string;
  files: Record<string, string>;
}

const COMPLETE_FILE = ".complete";

export function sumAssetBytes(manifest: ReadAloudManifest): number {
  return (
    manifest.runtime.bytes +
    manifest.model.reduce((sum, asset) => sum + asset.bytes, 0)
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path, { highWaterMark: 1 << 20 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", rejectPromise);
    stream.on("end", () => resolvePromise());
  });
  return hash.digest("hex");
}

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** What the folder says without hashing (Settings before the module loads; the first state). */
export function readAloudDiskState(
  directory: string,
  manifest: Pick<ReadAloudManifest, "modelFolder"> | null,
  bytes: number,
): ReadAloudDownloadState {
  const ready = existsSync(join(directory, READ_ALOUD_READY_FILE));
  const voices = cachedVoices(directory, manifest);
  const status = ready ? "ready" : existsSync(directory) ? "partial" : "absent";
  return {
    ...IDLE_READ_ALOUD_DOWNLOAD,
    status,
    bytes,
    voices: ready ? ["default", ...voices] : voices,
  };
}

function cachedVoices(
  directory: string,
  manifest: Pick<ReadAloudManifest, "modelFolder"> | null,
): string[] {
  try {
    const folder = join(directory, manifest?.modelFolder ?? "model", "voices");
    return readdirSync(folder)
      .filter((name) => /^[\w-]{1,40}\.safetensors$/.test(name))
      .map((name) => name.slice(0, -".safetensors".length));
  } catch {
    return [];
  }
}

export function createReadAloudDownloads(deps: ReadAloudDownloadDeps) {
  const interval = deps.progressIntervalMs ?? 150;
  let state: ReadAloudDownloadState = readAloudDiskState(
    deps.directory(),
    deps.manifest(),
    sumAssetBytes(deps.manifest()),
  );
  let modelRun: Promise<void> | null = null;
  let modelAbort: AbortController | null = null;
  const voiceRuns = new Map<string, Promise<void>>();
  let catalog: CatalogVoiceFile[] | null = null;
  let catalogRun: Promise<CatalogVoiceFile[]> | null = null;
  const voiceAborts = new Set<AbortController>();
  /** Checked against the hashes this run: never hashed again until deleted. */
  let modelVerified = false;
  const verifiedVoices = new Set<string>();

  const publish = (patch: Partial<ReadAloudDownloadState>): void => {
    state = { ...state, ...patch };
    deps.onState(snapshot());
  };

  function snapshot(): ReadAloudDownloadState {
    return {
      ...state,
      voices: [...state.voices],
      voice: state.voice ? { ...state.voice } : null,
    };
  }

  const root = (): string => deps.directory();
  const runtimeDirectory = (manifest: ReadAloudManifest): string =>
    join(root(), "runtime", `phonon-tts-${manifest.runtimeVersion}`);
  const assetPath = (asset: ReadAloudAsset): string => join(root(), asset.file);

  /** Stream `asset` with progress; sha256 (or npm integrity) checked before it replaces anything. */
  async function fetchAsset(
    asset: ReadAloudAsset,
    onBytes: (count: number) => void,
    signal: AbortSignal,
  ): Promise<Uint8Array | null> {
    const blocked = deps.blockedReason?.();
    if (blocked) throw new Error(blocked);
    const response = await deps.fetch(asset.url, {
      redirect: "follow",
      credentials: "omit",
      signal,
    } as RequestInit);
    if (!response.ok || !response.body)
      throw new Error(
        `${asset.label}: download failed (HTTP ${response.status})`,
      );
    const hash = createHash("sha256");
    const keepInMemory = Boolean(asset.integrity);
    const chunks: Uint8Array[] = [];
    const target = assetPath(asset);
    const partial = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    const handle = keepInMemory ? null : await open(partial, "w");
    let received = 0;
    try {
      const reader = response.body.getReader();
      const onAbort = (): void => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        while (true) {
          if (signal.aborted) throw new ReadAloudDownloadCancelled();
          const { done, value } = await reader.read();
          if (signal.aborted) throw new ReadAloudDownloadCancelled();
          if (done) break;
          received += value.byteLength;
          if (received > asset.bytes * 1.1 + 1024)
            throw new Error(`${asset.label}: larger than expected`);
          if (handle) {
            hash.update(value);
            await handle.write(value);
          } else {
            chunks.push(value);
          }
          onBytes(value.byteLength);
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    } catch (error) {
      await handle?.close();
      if (handle) await rm(partial, { force: true });
      throw error;
    }
    await handle?.close();
    if (asset.integrity) {
      const bytes = Buffer.concat(chunks);
      if (!matchesIntegrity(bytes, asset.integrity))
        throw new Error(`${asset.label}: checksum mismatch`);
      return bytes;
    }
    if (hash.digest("hex") !== asset.sha256) {
      await rm(partial, { force: true });
      throw new Error(`${asset.label}: checksum mismatch`);
    }
    await rename(partial, target);
    return null;
  }

  async function runtimeIsIntact(
    manifest: ReadAloudManifest,
    hashFiles: boolean,
  ): Promise<boolean> {
    const folder = runtimeDirectory(manifest);
    let marker: RuntimeMarker;
    try {
      marker = JSON.parse(
        await readFile(join(folder, COMPLETE_FILE), "utf8"),
      ) as RuntimeMarker;
    } catch {
      return false;
    }
    if (
      !marker ||
      marker.integrity !== manifest.runtime.integrity ||
      typeof marker.files !== "object" ||
      marker.files === null
    )
      return false;
    const entries = Object.entries(marker.files);
    if (!entries.some(([path]) => path === "index.js")) return false;
    for (const [path, sha] of entries) {
      const target = resolve(folder, path);
      if (!target.startsWith(folder + sep)) return false;
      if (hashFiles) {
        try {
          if ((await sha256File(target)) !== sha) return false;
        } catch {
          return false;
        }
      } else if ((await sizeOf(target)) === null) {
        return false;
      }
    }
    return true;
  }

  async function assetIsIntact(
    asset: ReadAloudAsset,
    hashFiles: boolean,
  ): Promise<boolean> {
    const path = assetPath(asset);
    if ((await sizeOf(path)) !== asset.bytes) return false;
    if (!hashFiles) return true;
    try {
      if ((await sha256File(path)) === asset.sha256) return true;
    } catch {
      return false;
    }
    await rm(path, { force: true });
    return false;
  }

  async function unpackRuntime(
    manifest: ReadAloudManifest,
    tarball: Uint8Array,
  ): Promise<void> {
    const files = readTarGz(tarball, isPhononRuntimeFile);
    if (
      !files.some((file) => file.path === "index.js") ||
      !files.some((file) => file.path === "worker.js")
    )
      throw new Error("Phonon runtime: unexpected package layout");
    const folder = runtimeDirectory(manifest);
    await rm(folder, { recursive: true, force: true });
    const marker: RuntimeMarker = {
      integrity: manifest.runtime.integrity ?? "",
      files: {},
    };
    for (const file of files) {
      const target = resolve(folder, file.path);
      if (!target.startsWith(folder + sep)) continue;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.data);
      marker.files[file.path] = createHash("sha256")
        .update(file.data)
        .digest("hex");
    }
    await writeFile(join(folder, COMPLETE_FILE), JSON.stringify(marker));
  }

  async function runModel(): Promise<void> {
    const manifest = deps.manifest();
    const bytes = sumAssetBytes(manifest);
    const abort = new AbortController();
    modelAbort = abort;
    const timeout = deps.timeoutMs
      ? setTimeout(
          () => abort.abort(new Error("The download timed out.")),
          deps.timeoutMs,
        )
      : null;
    try {
      const hashFiles = !modelVerified;
      if (hashFiles)
        publish({
          status: "checking",
          label: "Checking",
          loaded: 0,
          total: 0,
          bytes,
          error: "",
        });
      const runtimeMissing = !(await runtimeIsIntact(manifest, hashFiles));
      const missing: ReadAloudAsset[] = [];
      for (const asset of manifest.model) {
        if (abort.signal.aborted) throw new ReadAloudDownloadCancelled();
        if (!(await assetIsIntact(asset, hashFiles))) missing.push(asset);
      }
      if (!runtimeMissing && missing.length === 0) {
        if (!existsSync(join(root(), READ_ALOUD_READY_FILE)))
          await writeReady(manifest, bytes);
        modelVerified = true;
        publish({
          status: "ready",
          label: "",
          loaded: 0,
          total: 0,
          bytes,
          error: "",
          voices: voicesWithDefault(),
        });
        return;
      }
      const total =
        (runtimeMissing ? manifest.runtime.bytes : 0) +
        missing.reduce((sum, asset) => sum + asset.bytes, 0);
      let loaded = 0;
      let last = 0;
      const progress =
        (label: string) =>
        (count: number): void => {
          loaded += count;
          const now = Date.now();
          if (now - last < interval && loaded < total) return;
          last = now;
          publish({
            status: "downloading",
            label,
            loaded: Math.min(loaded, total),
            total,
          });
        };
      await rm(join(root(), READ_ALOUD_READY_FILE), { force: true });
      publish({
        status: "downloading",
        label: runtimeMissing ? manifest.runtime.label : missing[0]!.label,
        loaded: 0,
        total,
        bytes,
        error: "",
      });
      if (runtimeMissing) {
        const tarball = await fetchAsset(
          manifest.runtime,
          progress(manifest.runtime.label),
          abort.signal,
        );
        if (!tarball) throw new Error("Phonon runtime: empty download");
        await unpackRuntime(manifest, tarball);
      }
      for (const asset of missing)
        await fetchAsset(asset, progress(asset.label), abort.signal);
      await writeReady(manifest, bytes);
      modelVerified = true;
      publish({
        status: "ready",
        label: "",
        loaded: total,
        total,
        bytes,
        error: "",
        voices: voicesWithDefault(),
      });
    } catch (error) {
      const cancelled =
        error instanceof ReadAloudDownloadCancelled ||
        (abort.signal.aborted &&
          !(
            abort.signal.reason instanceof Error &&
            abort.signal.reason.message === "The download timed out."
          ));
      if (cancelled) {
        publish({ status: "cancelled", label: "", error: "" });
        throw new ReadAloudDownloadCancelled();
      }
      const message = abort.signal.aborted
        ? "The download timed out."
        : error instanceof Error
          ? error.message
          : String(error);
      publish({ status: "error", label: "", error: message });
      throw new Error(message, { cause: error });
    } finally {
      if (timeout) clearTimeout(timeout);
      if (modelAbort === abort) modelAbort = null;
    }
  }

  async function writeReady(
    manifest: ReadAloudManifest,
    bytes: number,
  ): Promise<void> {
    await mkdir(root(), { recursive: true });
    await writeFile(
      join(root(), READ_ALOUD_READY_FILE),
      JSON.stringify({
        runtime: manifest.runtimeVersion,
        bytes,
        at: new Date().toISOString(),
      }),
    );
  }

  function voicesWithDefault(): string[] {
    return ["default", ...cachedVoices(root(), deps.manifest())];
  }

  /** The runtime + model, checked once per run; downloads what is missing. Shared by concurrent callers. */
  function ensureModel(): Promise<void> {
    if (modelRun) return modelRun;
    const run = runModel();
    modelRun = run;
    const clear = (): void => {
      if (modelRun === run) modelRun = null;
    };
    run.then(clear, clear);
    return run;
  }

  async function runCatalog(): Promise<CatalogVoiceFile[]> {
    const manifest = deps.manifest();
    const source = manifest.catalog;
    if (!source) return [];
    const asset: ReadAloudAsset = {
      label: "Voice list",
      url: source.url,
      file: join(manifest.modelFolder, "voices.jsonl"),
      bytes: source.bytes,
      sha256: source.sha256,
    };
    if (!(await assetIsIntact(asset, true))) {
      const abort = new AbortController();
      voiceAborts.add(abort);
      const timeout = deps.timeoutMs
        ? setTimeout(() => abort.abort(), deps.timeoutMs)
        : null;
      try {
        await fetchAsset(asset, () => undefined, abort.signal);
      } finally {
        if (timeout) clearTimeout(timeout);
        voiceAborts.delete(abort);
      }
    }
    const parsed = parseVoiceCatalog(await readFile(assetPath(asset), "utf8"), {
      base: source.base,
      hashes: source.hashes,
      bytes: source.voiceBytes,
    });
    catalog = parsed;
    return parsed;
  }

  /** The English voices (fetched once, then read from the profile). Shared by concurrent callers. */
  function ensureCatalog(): Promise<CatalogVoiceFile[]> {
    if (catalog) return Promise.resolve(catalog);
    if (catalogRun) return catalogRun;
    const run = runCatalog();
    catalogRun = run;
    const clear = (): void => {
      if (catalogRun === run) catalogRun = null;
    };
    run.then(clear, clear);
    return run;
  }

  async function runVoice(voice: CatalogVoiceFile): Promise<void> {
    const manifest = deps.manifest();
    const asset: ReadAloudAsset = {
      label: `Voice: ${voice.name}`,
      url: voice.url,
      file: join(manifest.modelFolder, voice.file),
      bytes: voice.bytes,
      sha256: voice.sha256,
    };
    if (await assetIsIntact(asset, !verifiedVoices.has(voice.id))) {
      verifiedVoices.add(voice.id);
      return;
    }
    const abort = new AbortController();
    voiceAborts.add(abort);
    let loaded = 0;
    publish({ voice: { id: voice.id, loaded: 0, total: voice.bytes } });
    try {
      await fetchAsset(
        asset,
        (count) => {
          loaded += count;
          publish({
            voice: {
              id: voice.id,
              loaded: Math.min(loaded, voice.bytes),
              total: voice.bytes,
            },
          });
        },
        abort.signal,
      );
      verifiedVoices.add(voice.id);
      publish({
        voice: null,
        voices:
          state.status === "ready"
            ? voicesWithDefault()
            : cachedVoices(root(), manifest),
      });
    } catch (error) {
      publish({ voice: null });
      if (error instanceof ReadAloudDownloadCancelled || abort.signal.aborted)
        throw new ReadAloudDownloadCancelled();
      throw error;
    } finally {
      voiceAborts.delete(abort);
    }
  }

  /**
   * A catalog voice: fetched (~256 KB) the first time it's used. Resolves to the id to speak with:
   * the voice, or 'default' for the model's own voice or an id the catalog doesn't have.
   */
  async function ensureVoice(id: string): Promise<string> {
    if (id === "default") return "default";
    const voice = (await ensureCatalog()).find(
      (candidate) => candidate.id === id,
    );
    if (!voice) return "default";
    let run = voiceRuns.get(id);
    if (!run) {
      run = runVoice(voice);
      voiceRuns.set(id, run);
      const created = run;
      const clear = (): void => {
        if (voiceRuns.get(id) === created) voiceRuns.delete(id);
      };
      created.then(clear, clear);
    }
    await run;
    return id;
  }

  function cancel(): void {
    modelAbort?.abort();
    for (const abort of voiceAborts) abort.abort();
  }

  async function deleteAll(): Promise<void> {
    cancel();
    await Promise.allSettled([
      modelRun ?? Promise.resolve(),
      ...voiceRuns.values(),
    ]);
    await rm(root(), { recursive: true, force: true });
    modelVerified = false;
    verifiedVoices.clear();
    catalog = null;
    publish({
      ...IDLE_READ_ALOUD_DOWNLOAD,
      bytes: sumAssetBytes(deps.manifest()),
    });
  }

  return {
    state: snapshot,
    ensureModel,
    ensureVoice,
    ensureCatalog,
    cancel,
    deleteAll,
    isReady: (): boolean => state.status === "ready" && modelVerified,
    runtimeDirectory: (): string => runtimeDirectory(deps.manifest()),
  };
}
