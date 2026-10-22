import { describe, expect, test } from "bun:test";
import {
  canOfferReadAloud,
  DEFAULT_READ_ALOUD_SETTINGS,
  isCommandHiddenByReadAloud,
  isLoopbackSpeechEndpoint,
  isReadAloudActive,
  isReadAloudControl,
  formatSpeed,
  normalizeSpeed,
  parseReadAloudSettings,
  READ_ALOUD_SPEED_PRESETS,
  speechEndpointUrl,
} from "./read-aloud";
import {
  downloadPercent,
  isReadAloudDownloadBusy,
  mergeTestStats,
  parseReadAloudTestRequest,
  READ_ALOUD_SAMPLE_TEXT,
  READ_ALOUD_TEST_MAX_CHARS,
  realtimeFactor,
} from "./read-aloud-tester";
import {
  firstUseDownloadBytes,
  formatDownloadSize,
  isPhononRuntimeFile,
  parseReadAloudTestManifest,
  PHONON_MANIFEST,
  PHONON_MODEL_ASSETS,
  PHONON_RUNTIME,
  PHONON_VOICE_CATALOG,
  parseModelConditioners,
} from "./read-aloud-assets";
import {
  lookaheadFor,
  MODEL_MAX_RATE,
  MODEL_MIN_RATE,
  rateToDurationDelta,
  splitSpeed,
} from "./read-aloud-speed";
import { stretchAll, WsolaStretcher } from "./read-aloud-stretch";
import {
  ENGLISH_VOICE_SHA256,
  filterVoices,
  groupVoices,
  MODEL_VOICE,
  parseVoiceCatalog,
  RECOMMENDED_VOICE_IDS,
  VOICE_CATALOG_URL,
  voiceSummary,
} from "./read-aloud-voices";

describe("read aloud settings", () => {
  test("off by default (experimental), Phonon engine, default voice, 1x", () => {
    expect(parseReadAloudSettings(null)).toEqual(DEFAULT_READ_ALOUD_SETTINGS);
    expect(DEFAULT_READ_ALOUD_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_READ_ALOUD_SETTINGS.engine).toBe("phonon");
  });

  test("Phonon levers default to phonon-tts's own defaults, on the CPU with 2 threads", () => {
    expect(DEFAULT_READ_ALOUD_SETTINGS).toMatchObject({
      temperature: 0.3,
      varySeed: false,
      rewrites: "default",
      device: "cpu",
      threads: 2,
      conditions: {},
    });
  });

  test("keeps valid fields, falls back on junk", () => {
    const parsed = parseReadAloudSettings({
      enabled: true,
      engine: "system",
      voice: "NbpkqMVS3CJeq2j8",
      speed: 2.27,
      endpoint: "http://localhost:8880/v1/",
      endpointVoice: "  alloy ",
      temperature: 0.62,
      varySeed: true,
      rewrites: "all",
      device: "webgpu",
      threads: 4,
      conditions: { num_speakers: "1" },
    });
    expect(parsed).toEqual({
      enabled: true,
      engine: "system",
      voice: "NbpkqMVS3CJeq2j8",
      speed: 2.25,
      endpoint: "http://localhost:8880/v1",
      endpointVoice: "alloy",
      temperature: 0.6,
      varySeed: true,
      rewrites: "all",
      device: "webgpu",
      threads: 4,
      conditions: { num_speakers: "1" },
    });
    const junk = parseReadAloudSettings({
      enabled: "yes",
      engine: "cloud",
      voice: "../nobody",
      speed: "fast",
      endpoint: "https://api.openai.com/v1",
      temperature: "hot",
      varySeed: 1,
      rewrites: "some",
      device: "tpu",
      threads: 99,
      conditions: "x",
    });
    expect(junk).toEqual(DEFAULT_READ_ALOUD_SETTINGS);
    expect(parseReadAloudSettings({ temperature: 7 }).temperature).toBe(1);
    expect(parseReadAloudSettings({ temperature: -1 }).temperature).toBe(0);
    expect(parseReadAloudSettings({ threads: "auto" }).threads).toBe("auto");
    expect(parseReadAloudSettings({ threads: 2.5 }).threads).toBe(2);
  });

  test("conditions: only conditioner-shaped names and simple values; duration_delta belongs to speed", () => {
    expect(
      parseReadAloudSettings({
        conditions: {
          num_speakers: "2",
          padding_bonus: 0.51234,
          duration_delta: -9,
          "bad name": 1,
          x: { y: 1 },
          z: "a b",
        },
      }).conditions,
    ).toEqual({ num_speakers: "2", padding_bonus: 0.512 });
  });

  test("migrates files from older builds: old speeds, no levers, stray tester keys", () => {
    // Round 1-2 files: speed on the 0.8–1.5 list, a tester engine that was never a setting.
    const old = parseReadAloudSettings({
      enabled: true,
      engine: "system",
      voice: "GgfEkEJtxZR7gnpy",
      speed: 1.15,
      endpoint: "http://127.0.0.1:8880/v1",
      endpointVoice: "",
      testEngine: "openai",
      testerEngine: "phonon",
    });
    expect(old).toEqual({
      ...DEFAULT_READ_ALOUD_SETTINGS,
      enabled: true,
      engine: "system",
      voice: "GgfEkEJtxZR7gnpy",
      speed: 1.15,
    });
    expect(old).not.toHaveProperty("testEngine");
    for (const speed of [0.8, 1, 1.15, 1.3, 1.5])
      expect(parseReadAloudSettings({ speed }).speed).toBe(speed);
    // Hand-edited: "2x" strings and out-of-range rates.
    expect(parseReadAloudSettings({ speed: "2x" }).speed).toBe(2);
    expect(parseReadAloudSettings({ speed: "1.5×" }).speed).toBe(1.5);
    expect(parseReadAloudSettings({ speed: 9 }).speed).toBe(3);
    expect(parseReadAloudSettings({ speed: 0.1 }).speed).toBe(0.75);
  });

  test("a change keeps the current settings for fields it leaves out", () => {
    const current = parseReadAloudSettings({
      enabled: true,
      voice: "X6NceqF285Gr04gb",
      speed: 1.15,
      temperature: 0.5,
      conditions: { num_speakers: "1" },
    });
    expect(parseReadAloudSettings({ speed: 0.8 }, current)).toEqual({
      ...current,
      speed: 0.8,
    });
    expect(
      parseReadAloudSettings({ conditions: {} }, current).conditions,
    ).toEqual({});
  });

  test("the speech endpoint must stay on this machine", () => {
    expect(isLoopbackSpeechEndpoint("http://127.0.0.1:8880/v1")).toBe(true);
    expect(isLoopbackSpeechEndpoint("http://[::1]:8880")).toBe(true);
    expect(isLoopbackSpeechEndpoint("https://api.openai.com/v1")).toBe(false);
    expect(isLoopbackSpeechEndpoint("http://user:pw@127.0.0.1:8880")).toBe(
      false,
    );
    expect(isLoopbackSpeechEndpoint("file:///etc/passwd")).toBe(false);
    expect(speechEndpointUrl("http://127.0.0.1:8880/v1")).toBe(
      "http://127.0.0.1:8880/v1/audio/speech",
    );
    expect(speechEndpointUrl("http://127.0.0.1:8880/")).toBe(
      "http://127.0.0.1:8880/v1/audio/speech",
    );
    expect(speechEndpointUrl("http://10.0.0.2:8880/v1")).toBeNull();
  });
});

describe("speed", () => {
  test("0.75–3x in 0.05 steps, presets up to 3x", () => {
    expect(normalizeSpeed(1.4)).toBe(1.4);
    expect(normalizeSpeed(2.33)).toBe(2.35);
    expect(normalizeSpeed(9)).toBe(3);
    expect(normalizeSpeed(Number.NaN)).toBe(1);
    expect(normalizeSpeed(0)).toBe(1);
    expect([...READ_ALOUD_SPEED_PRESETS]).toEqual([
      0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
    ]);
    expect(formatSpeed(1.25)).toBe("1.25×");
    expect(formatSpeed(2)).toBe("2×");
  });

  test("duration_delta follows the measured curve, clamped to what the model follows", () => {
    expect(rateToDurationDelta(1)).toBe(0);
    expect(rateToDurationDelta(1.15)).toBe(-0.2);
    expect(rateToDurationDelta(1.25)).toBe(-0.4);
    expect(rateToDurationDelta(0.9)).toBe(0.2);
    expect(rateToDurationDelta(0.87)).toBe(0.3);
    // Past the measured range the model stops following (and below -1 breaks): never asked for.
    expect(rateToDurationDelta(3)).toBe(-0.4);
    expect(rateToDurationDelta(0.5)).toBe(0.3);
    expect(rateToDurationDelta(1.2)).toBeCloseTo(-0.3, 5);
  });

  test("split: the model does up to 1.25x, a time stretch does the rest", () => {
    expect(splitSpeed(1)).toEqual({
      speed: 1,
      modelRate: 1,
      durationDelta: 0,
      stretch: 1,
    });
    expect(splitSpeed(1.25)).toEqual({
      speed: 1.25,
      modelRate: 1.25,
      durationDelta: -0.4,
      stretch: 1,
    });
    expect(splitSpeed(1.15)).toMatchObject({ modelRate: 1.15, stretch: 1 });
    for (const speed of [1.5, 1.75, 2, 2.5, 3]) {
      const split = splitSpeed(speed);
      expect(split.modelRate).toBe(MODEL_MAX_RATE);
      expect(split.durationDelta).toBe(-0.4);
      expect(split.modelRate * split.stretch).toBeCloseTo(speed, 3);
    }
    expect(splitSpeed(2).stretch).toBe(1.6);
    expect(splitSpeed(3).stretch).toBe(2.4);
    // Below the model's slowest, the stretch slows it further (still pitch-preserving).
    const slow = splitSpeed(0.75);
    expect(slow.modelRate).toBe(MODEL_MIN_RATE);
    expect(slow.durationDelta).toBe(0.3);
    expect(slow.stretch).toBeLessThan(1);
    expect(slow.modelRate * slow.stretch).toBeCloseTo(0.75, 3);
  });

  test("prefetch reaches further ahead at high speed", () => {
    expect(lookaheadFor(1)).toBe(1);
    expect(lookaheadFor(1.5)).toBe(2);
    expect(lookaheadFor(3)).toBe(3);
  });
});

/** Zero crossings per second of a signal (its pitch, for a sine). */
function crossingRate(pcm: Float32Array, sampleRate: number): number {
  let crossings = 0;
  for (let index = 1; index < pcm.length; index += 1)
    if (pcm[index - 1]! < 0 !== pcm[index]! < 0) crossings += 1;
  return crossings / 2 / (pcm.length / sampleRate);
}

function tone(
  seconds: number,
  frequency: number,
  sampleRate = 24000,
): Float32Array {
  const pcm = new Float32Array(Math.round(seconds * sampleRate));
  for (let index = 0; index < pcm.length; index += 1)
    pcm[index] = 0.5 * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
  return pcm;
}

describe("time stretch (WSOLA)", () => {
  test("rate 1 is a passthrough", () => {
    const input = tone(0.2, 220);
    const stretcher = new WsolaStretcher(1);
    expect(stretcher.push(input)).toBe(input);
    expect(stretcher.flush().length).toBe(0);
  });

  test("1.6x, 2x and 2.4x shorten the audio but keep the pitch (no chipmunk)", () => {
    const input = tone(2, 180);
    for (const rate of [1.6, 2, 2.4]) {
      const out = stretchAll(input, rate);
      expect(Math.abs(out.length - input.length / rate)).toBeLessThan(10);
      // Skip the fade-in/out grains at the edges.
      const middle = out.subarray(600, out.length - 600);
      expect(crossingRate(middle, 24000)).toBeGreaterThan(175);
      expect(crossingRate(middle, 24000)).toBeLessThan(185);
    }
  });

  test("slowing down (0.86x) lengthens and keeps the pitch", () => {
    const input = tone(1, 200);
    const out = stretchAll(input, 0.862);
    expect(Math.abs(out.length - input.length / 0.862)).toBeLessThan(10);
    const rate = crossingRate(out.subarray(600, out.length - 600), 24000);
    expect(rate).toBeGreaterThan(195);
    expect(rate).toBeLessThan(205);
  });

  test("streaming in 80 ms chunks gives the same audio as one buffer", () => {
    const input = tone(1.5, 150);
    const whole = stretchAll(input, 2);
    const stretcher = new WsolaStretcher(2);
    const parts: number[] = [];
    for (let offset = 0; offset < input.length; offset += 1920)
      parts.push(...stretcher.push(input.subarray(offset, offset + 1920)));
    parts.push(...stretcher.flush());
    expect(parts.length).toBe(whole.length);
    let maxDiff = 0;
    for (let index = 0; index < whole.length; index += 1)
      maxDiff = Math.max(maxDiff, Math.abs(parts[index]! - whole[index]!));
    expect(maxDiff).toBeLessThan(1e-6);
  });

  test("no clicks: a stretched tone stays smooth (no sample jumps past the tone's own slope)", () => {
    const out = stretchAll(tone(1, 160), 2.4);
    const slope = (0.5 * 2 * Math.PI * 160) / 24000;
    let worst = 0;
    for (let index = 601; index < out.length - 600; index += 1)
      worst = Math.max(worst, Math.abs(out[index]! - out[index - 1]!));
    expect(worst).toBeLessThan(slope * 1.6);
  });

  test("keeps up: 3 s of audio at 2.4x in well under real time", () => {
    const input = tone(3, 170);
    const started = performance.now();
    stretchAll(input, 2.4);
    expect(performance.now() - started).toBeLessThan(600);
  });

  test("silence and tiny inputs are fine", () => {
    expect(stretchAll(new Float32Array(0), 2).length).toBe(0);
    expect(stretchAll(new Float32Array(100), 2).length).toBe(50);
  });
});

describe("voice catalog", () => {
  const line = (fields: Record<string, unknown>): string =>
    JSON.stringify({
      language: "en",
      locale: "en-us",
      gender: "female",
      age: "Adult",
      description: "Warm and calm.",
      ...fields,
      filename: `voices/${String(fields.voice_id)}.safetensors`,
    });
  const hashes = {
    a1: "a".repeat(64),
    b2: "b".repeat(64),
    c3: "c".repeat(64),
    d4: "d".repeat(64),
    e5: "e".repeat(64),
    f6: "f".repeat(64),
  };
  const jsonl = [
    line({ voice_id: "b2", name: "Zoey" }),
    line({
      voice_id: "a1",
      name: "Alfie",
      locale: "en-gb",
      gender: "male",
      description: "Crisp British.",
    }),
    line({
      voice_id: "c3",
      name: "Captain",
      locale: "characters",
      gender: null,
      age: null,
      description: "A pirate.",
    }),
    line({ voice_id: "d4", name: "Nele", language: "de", locale: "de-de" }),
    line({ voice_id: "e5", name: "Aussie", locale: "en-au" }),
    line({ voice_id: "zz", name: "No hash" }),
    line({ voice_id: "../x", name: "Bad id" }),
    "not json",
    "",
    JSON.stringify({
      voice_id: "f6",
      name: "Wrong file",
      language: "en",
      locale: "en-us",
      filename: "elsewhere/f6.safetensors",
    }),
    line({ voice_id: "b2", name: "Duplicate" }),
  ].join("\n");

  test("English voices with a known hash only, grouped US / UK / other / characters", () => {
    const voices = parseVoiceCatalog(jsonl, {
      base: "https://example.test/repo/",
      hashes,
    });
    expect(voices.map((voice) => [voice.id, voice.name, voice.accent])).toEqual(
      [
        ["b2", "Zoey", "us"],
        ["a1", "Alfie", "uk"],
        ["e5", "Aussie", "other"],
        ["c3", "Captain", "characters"],
      ],
    );
    expect(voices[0]).toMatchObject({
      file: "voices/b2.safetensors",
      url: "https://example.test/repo/voices/b2.safetensors",
      sha256: "b".repeat(64),
      bytes: 256136,
      gender: "female",
      age: "Adult",
    });
    expect(voices[3]).toMatchObject({ gender: "", age: "" });
    expect(
      groupVoices([MODEL_VOICE, ...voices]).map((group) => [
        group.label,
        group.voices.length,
      ]),
    ).toEqual([
      ["Model voice", 1],
      ["American English", 1],
      ["British English", 1],
      ["Other English", 1],
      ["Characters", 1],
    ]);
  });

  test("a Recommended group comes first when asked for, each voice listed once", () => {
    const harper = {
      id: RECOMMENDED_VOICE_IDS[0]!,
      name: "Harper",
      accent: "us" as const,
      gender: "female",
      age: "Adult",
      description: "",
    };
    const zoey = {
      id: "z1",
      name: "Zoey",
      accent: "us" as const,
      gender: "female",
      age: "Adult",
      description: "",
    };
    const groups = groupVoices([MODEL_VOICE, harper, zoey], {
      recommended: true,
    });
    expect(
      groups.map((group) => [
        group.key,
        group.voices.map((voice) => voice.name),
      ]),
    ).toEqual([
      ["recommended", ["Harper"]],
      ["model", ["Default"]],
      ["us", ["Zoey"]],
    ]);
    expect(
      groupVoices([MODEL_VOICE, harper, zoey]).map((group) => group.key),
    ).toEqual(["model", "us"]);
    expect(voiceSummary(harper, { accent: true })).toBe(
      "Harper · American, female",
    );
    expect(voiceSummary(harper)).toBe("Harper · female, Adult");
  });

  test("every recommended voice is an English catalog voice with a pinned hash", () => {
    expect(RECOMMENDED_VOICE_IDS.length).toBeGreaterThanOrEqual(4);
    for (const id of RECOMMENDED_VOICE_IDS)
      expect(ENGLISH_VOICE_SHA256[id]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("search matches name, accent, gender and description words", () => {
    const voices = parseVoiceCatalog(jsonl, {
      base: "https://example.test/repo",
      hashes,
    });
    expect(filterVoices(voices, "british").map((voice) => voice.id)).toEqual([
      "a1",
    ]);
    expect(filterVoices(voices, "MALE crisp").map((voice) => voice.id)).toEqual(
      ["a1"],
    );
    expect(filterVoices(voices, "pirate").map((voice) => voice.id)).toEqual([
      "c3",
    ]);
    expect(
      filterVoices(voices, "warm american").map((voice) => voice.id),
    ).toEqual(["b2"]);
    expect(filterVoices(voices, "  ").length).toBe(4);
    expect(filterVoices(voices, "nobody")).toEqual([]);
    expect(voiceSummary(voices[0]!)).toBe("Zoey · female, Adult");
    expect(voiceSummary(voices[3]!)).toBe("Captain");
  });

  test("the real catalog: 37 English voices pinned to a commit, hashes for each", () => {
    expect(VOICE_CATALOG_URL).toMatch(
      /^https:\/\/huggingface\.co\/gradium\/phonon-voices\/resolve\/[0-9a-f]{40}\/voices\.jsonl$/,
    );
    expect(PHONON_VOICE_CATALOG.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(ENGLISH_VOICE_SHA256).length).toBe(37);
    for (const hash of Object.values(ENGLISH_VOICE_SHA256))
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Round 2's Freya and Zoey are still there with the same hashes.
    expect(ENGLISH_VOICE_SHA256.GgfEkEJtxZR7gnpy).toBe(
      "eb3cd47418349e618408c16bea7153988b3ad04b41a6033039dd474a9a4dcd23",
    );
    expect(ENGLISH_VOICE_SHA256.NbpkqMVS3CJeq2j8).toBe(
      "97c7f8c253413574406ab80dd23f49c3ebb2517163b00a9bf86b9c4cf43e7e23",
    );
  });

  test("model conditioners: everything config.json lists except duration_delta", () => {
    const config = {
      conditioners: [
        {
          type: "lut",
          lut: { n_bins: 31, possible_values: ["0", "1", "2"] },
          name: "num_speakers",
        },
        {
          type: "continuous",
          continuous: { scale_factor: 1000 },
          name: "duration_delta",
        },
        { type: "continuous", continuous: {}, name: "padding_bonus" },
        { type: "weird", name: "other" },
        { type: "lut", lut: { possible_values: [] }, name: "empty" },
      ],
    };
    expect(parseModelConditioners(config)).toEqual([
      { name: "num_speakers", type: "lut", values: ["0", "1", "2"] },
      { name: "padding_bonus", type: "continuous", values: [] },
    ]);
    expect(parseModelConditioners({ fixture: true })).toEqual([]);
    expect(parseModelConditioners(null)).toEqual([]);
  });
});

describe("download manifest", () => {
  test("pins the Apache-2.0 31M model, never the CC BY-NC 40M ones", () => {
    for (const asset of PHONON_MODEL_ASSETS) {
      expect(asset.url).toContain(
        "huggingface.co/gradium/phonon-31m-en/resolve/8c64b55ec301728e2d1695bfea87a08a267d0c2d/",
      );
      expect(asset.url).not.toContain("40m");
      expect(asset.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(PHONON_VOICE_CATALOG.base).toMatch(
      /^https:\/\/huggingface\.co\/gradium\/phonon-voices\/resolve\/[0-9a-f]{40}$/,
    );
    expect(
      PHONON_MODEL_ASSETS.find((asset) => asset.file.endsWith(".gguf"))?.bytes,
    ).toBe(64512352);
  });

  test("the runtime is the official npm package, checked by its registry integrity", () => {
    expect(PHONON_RUNTIME.url).toBe(
      "https://registry.npmjs.org/phonon-tts/-/phonon-tts-0.4.0.tgz",
    );
    expect(PHONON_RUNTIME.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
  });

  test("the model download is 71 MB (decimal units, like Finder)", () => {
    expect(firstUseDownloadBytes()).toBe(70976881);
    expect(formatDownloadSize(firstUseDownloadBytes())).toBe("71 MB");
    expect(formatDownloadSize(256136)).toBe("256 KB");
    expect(formatDownloadSize(5927575)).toBe("5.9 MB");
    expect(formatDownloadSize(0)).toBe("0 B");
  });

  test("the manifest bundles the pinned files", () => {
    expect(PHONON_MANIFEST.runtime).toBe(PHONON_RUNTIME);
    expect(PHONON_MANIFEST.model).toBe(PHONON_MODEL_ASSETS);
    expect(PHONON_MANIFEST.modelFolder).toBe("model");
  });

  test("smoke manifest: loopback fixtures with their own hashes only", () => {
    const sha = "a".repeat(64);
    const file = (name: string) => ({
      url: `http://127.0.0.1:4000/${name}`,
      bytes: 10,
      sha256: sha,
    });
    const valid = {
      runtime: {
        url: "http://127.0.0.1:4000/rt.tgz",
        bytes: 100,
        integrity: "sha512-abc=",
      },
      model: {
        "model.q8.gguf": file("m"),
        "tokenizer.json": file("t"),
        "config.json": file("c"),
        "default-voice.safetensors": file("v"),
      },
    };
    const parsed = parseReadAloudTestManifest(valid);
    expect(parsed?.model.map((asset) => asset.file)).toEqual([
      "model/model.q8.gguf",
      "model/tokenizer.json",
      "model/config.json",
      "model/default-voice.safetensors",
    ]);
    expect(parsed?.catalog).toBeNull();
    const catalog = {
      url: "http://127.0.0.1:4000/voices.jsonl",
      base: "http://127.0.0.1:4000/voices",
      sha256: sha,
      bytes: 100,
      voiceBytes: 10,
      hashes: { v1: sha, "../x": sha },
    };
    expect(parseReadAloudTestManifest({ ...valid, catalog })?.catalog).toEqual({
      ...catalog,
      hashes: { v1: sha },
    });
    expect(
      parseReadAloudTestManifest({
        ...valid,
        catalog: { ...catalog, base: "https://huggingface.co/x" },
      })?.catalog,
    ).toBeNull();
    expect(
      parseReadAloudTestManifest({
        ...valid,
        runtime: { ...valid.runtime, url: "https://evil.example/rt.tgz" },
      }),
    ).toBeNull();
    expect(
      parseReadAloudTestManifest({
        ...valid,
        model: {
          ...valid.model,
          "config.json": { ...file("c"), sha256: "nope" },
        },
      }),
    ).toBeNull();
    expect(parseReadAloudTestManifest(null)).toBeNull();
  });

  test("unpacks only the JS and the Relaxed SIMD wasm builds, never paths outside the folder", () => {
    for (const path of [
      "index.js",
      "worker.js",
      "wasm/phonon_tts.js",
      "wasm/phonon_tts_bg.wasm",
      "wasm-threads/phonon_tts_bg.wasm",
      "wasm-threads/snippets/wasm-bindgen-rayon-38edf6e439f6d70d/src/workerHelpers.js",
      "LICENSE-MIT",
    ]) {
      expect(isPhononRuntimeFile(path)).toBe(true);
    }
    for (const path of [
      "wasm/phonon_tts_simd_bg.wasm",
      "index.d.ts",
      "README.md",
      "package.json",
      "../evil.js",
      "/etc/x.js",
      "wasm/../../x.js",
    ]) {
      expect(isPhononRuntimeFile(path)).toBe(false);
    }
  });
});

describe("download state", () => {
  test("percent is whole, clamped and 0 while the total is unknown", () => {
    expect(downloadPercent(0, 0)).toBe(0);
    expect(downloadPercent(50, 0)).toBe(0);
    expect(downloadPercent(35_488_440, 70_976_881)).toBe(49);
    expect(downloadPercent(80, 70)).toBe(100);
  });
  test("checking and downloading are busy (Cancel shows)", () => {
    expect(isReadAloudDownloadBusy({ status: "downloading" })).toBe(true);
    expect(isReadAloudDownloadBusy({ status: "checking" })).toBe(true);
    expect(isReadAloudDownloadBusy({ status: "ready" })).toBe(false);
    expect(isReadAloudDownloadBusy({ status: "error" })).toBe(false);
  });
});

describe("voice tester", () => {
  test("requests: empty text speaks the sample, long text is capped, bad fields fall back", () => {
    expect(parseReadAloudTestRequest({ text: "   " })).toEqual({
      text: READ_ALOUD_SAMPLE_TEXT,
    });
    expect(parseReadAloudTestRequest({ text: "x".repeat(5000) })).toEqual({
      text: "x".repeat(READ_ALOUD_TEST_MAX_CHARS),
    });
    // The tester speaks with Read Aloud's own settings: an old renderer's engine/voice/speed are dropped.
    expect(
      parseReadAloudTestRequest({
        text: "hi",
        engine: "system",
        voice: "x",
        speed: 2,
      }),
    ).toEqual({ text: "hi" });
    expect(parseReadAloudTestRequest("nope")).toBeNull();
  });
  test("real-time factor: compute seconds per audio second", () => {
    expect(realtimeFactor({ generateMs: 853, audioSeconds: 4.08 })).toBe(0.21);
    expect(realtimeFactor({ generateMs: null, audioSeconds: 4 })).toBeNull();
    expect(realtimeFactor({ generateMs: 100, audioSeconds: 0 })).toBeNull();
    expect(realtimeFactor(null)).toBeNull();
  });
  test("stats merge first-audio and final reports, ignoring junk", () => {
    const first = mergeTestStats(null, {
      loadMs: 987,
      cold: true,
      firstAudioMs: 100,
      threads: 3,
      device: "cpu",
      deviceReason: "WebGPU was not asked for",
      threadsReason: "auto: 3",
    });
    expect(first).toEqual({
      loadMs: 987,
      cold: true,
      firstAudioMs: 100,
      audioSeconds: null,
      generateMs: null,
      threads: 3,
      device: "cpu",
      deviceReason: "WebGPU was not asked for",
      threadsReason: "auto: 3",
    });
    const final = mergeTestStats(first, {
      generateMs: 853,
      audioSeconds: 4.08,
      loadMs: -5,
      firstAudioMs: "x",
      device: "<b>",
    });
    expect(final).toEqual({ ...first!, audioSeconds: 4.08, generateMs: 853 });
    expect(mergeTestStats(first, null)).toBe(first);
  });
});

describe("gating", () => {
  test("palette entries hide while off", () => {
    expect(isCommandHiddenByReadAloud("readAloud.page", false)).toBe(true);
    expect(isCommandHiddenByReadAloud("readAloud.page", true)).toBe(false);
    expect(isCommandHiddenByReadAloud("tab.new", false)).toBe(false);
  });

  test("menu entries: on, a web page or a PDF", () => {
    expect(
      canOfferReadAloud({
        enabled: true,
        url: "https://example.com/a",
        pdf: false,
      }),
    ).toBe(true);
    expect(
      canOfferReadAloud({
        enabled: false,
        url: "https://example.com/a",
        pdf: false,
      }),
    ).toBe(false);
    expect(
      canOfferReadAloud({
        enabled: true,
        url: "https://example.com/a.pdf",
        pdf: true,
      }),
    ).toBe(true);
    expect(
      canOfferReadAloud({ enabled: true, url: "file:///tmp/a.pdf", pdf: true }),
    ).toBe(true);
    expect(
      canOfferReadAloud({
        enabled: false,
        url: "file:///tmp/a.pdf",
        pdf: true,
      }),
    ).toBe(false);
    expect(
      canOfferReadAloud({
        enabled: true,
        url: "surffish://newtab",
        pdf: false,
      }),
    ).toBe(false);
  });

  test("controls and active states", () => {
    expect(isReadAloudControl("next")).toBe(true);
    expect(isReadAloudControl("rm -rf")).toBe(false);
    expect(isReadAloudActive({ status: "paused" })).toBe(true);
    expect(isReadAloudActive({ status: "error" })).toBe(false);
    expect(isReadAloudActive({ status: "idle" })).toBe(false);
  });
});
