// Surffish Read Aloud engine page (surffish-tts://engine/read-aloud.html, a hidden window main opens
// on the first reading and closes 3 minutes after the last one or the last voice test; see
// src/main/read-aloud.ts). Speaks the sentences main sends with Phonon
// (the official `phonon-tts` WebAssembly build, downloaded into the profile and served by main under
// /runtime/ and /model/), falling back to the system voices (speechSynthesis) when Phonon can't
// start, or through a local OpenAI-compatible server (main fetches it). Audio is streamed in 80 ms
// chunks onto a Web Audio timeline, 1–3 sentences ahead (more at high speed) and at most MAX_AHEAD_S
// of audio, so generation idles between sentences. Nothing ticks while paused, and when a reading
// ends the AudioContext is closed and the silent Media Session element dropped, so an idle engine
// page holds no audio device, timer or media session. The page is cross-origin isolated, so the
// threaded wasm build runs. A Media Session makes hardware media keys and Now Playing work.
import { ReadAloudPlan, pcm16ToFloat32 } from '../../../shared/read-aloud-queue'
import { WsolaStretcher } from '../../../shared/read-aloud-stretch'

type EngineId = 'phonon' | 'system' | 'openai'

interface SpeakCommand {
  type: 'speak' | 'respeak'
  token: number
  sentences: string[]
  start: number
  engine: EngineId
  voice: { id: string; file: string }
  speed: number
  /** Phonon: the model-native part of the speed (`duration_delta`)… */
  durationDelta: number
  /** …and the rest, as a pitch-preserving time stretch of its audio (1 = none). */
  stretch?: number
  /** Sentences generated ahead of the one playing. */
  lookahead?: number
  temperature?: number
  seed?: number
  /** Phonon load options; a change reloads the model (from disk). */
  load?: { rewrites?: string; device?: string; threads?: number | 'auto'; conditions?: Record<string, string | number> }
  title: string
  fallbackReason?: string
  /** Settings' voice tester: the same path, with the timing numbers reported at the end too. */
  test?: boolean
}

type Command =
  | SpeakCommand
  | { type: 'control'; token: number; action: 'pause' | 'resume' | 'next' | 'previous' }
  | { type: 'stop' }
  /** A PDF's text for a reading (pdf.js, loaded on the first one): answered with a `pdf-text` event. */
  | { type: 'pdf-text'; id: number; bytes: Uint8Array }

interface EngineBridge {
  onCommand(callback: (command: Command) => void): void
  send(event: Record<string, unknown>): void
  speech(text: string): Promise<{ ok: true; pcm: Uint8Array; sampleRate: number } | { ok: false; error: string }>
}

/** The parts of phonon-tts's PhononTTS this page uses (the package is loaded at runtime, not bundled). */
interface PhononSpeech extends AsyncIterable<Float32Array> {
  readonly done: Promise<{ firstAudioMs?: number | null; cancelled: boolean }>
  cancel(): void
}
interface PhononInstance {
  readonly sampleRate: number
  readonly voices: string[]
  readonly threads: number
  readonly threadsReason: string
  readonly device: string
  readonly deviceReason: string
  addVoice(name: string, source: string): Promise<void>
  stream(text: string, options?: { voice?: string; temperature?: number; seed?: number; signal?: AbortSignal }): PhononSpeech
  dispose(): void
}
interface PhononModule {
  PhononTTS: { load(options: Record<string, unknown>): Promise<PhononInstance> }
}

const bridge = (window as unknown as { surffishReadAloudEngine?: EngineBridge }).surffishReadAloudEngine
const ORIGIN = location.origin
/** Silence between sentences, on top of what the model leaves. */
const SENTENCE_GAP_S = 0.06
const TICK_MS = 100
/**
 * Audio scheduled ahead before generation pauses (seconds of playback). With the 1–3 sentence
 * lookahead, this keeps the CPU idle between sentences once a comfortable buffer is there, at any
 * speed, instead of generating as far ahead as the lookahead allows.
 */
const MAX_AHEAD_S = 12
const MAX_FAILURES_IN_A_ROW = 3

function emit(event: Record<string, unknown>): void {
  bridge?.send(event)
}

// ---------------------------------------------------------------------------
// Phonon

let phonon: { tts: PhononInstance; key: string } | null = null
let phononLoading: Promise<PhononInstance> | null = null

/** Everything `PhononTTS.load` takes from the settings; a different key means a fresh instance. */
function loadOptions(command: SpeakCommand): { key: string; options: Record<string, unknown> } {
  const load = command.load ?? {}
  const options = {
    rewrites: load.rewrites ?? 'default',
    device: load.device ?? 'cpu',
    threads: load.threads ?? 'auto',
    conditions: { ...(load.conditions ?? {}), duration_delta: command.durationDelta }
  }
  return { key: JSON.stringify(options), options }
}

async function loadPhonon(command: SpeakCommand): Promise<PhononInstance> {
  const { key, options } = loadOptions(command)
  if (phonon && phonon.key === key) return phonon.tts
  // Speed, rewrites, device and threads are load-time options, so a change means a fresh instance
  // (the files come from disk).
  while (phononLoading) await phononLoading.catch(() => undefined)
  if (phonon && phonon.key === key) return phonon.tts
  phonon?.tts.dispose()
  phonon = null
  const run = (async () => {
    const module = await import(/* @vite-ignore */ `${ORIGIN}/runtime/index.js`) as PhononModule
    const model = `${ORIGIN}/model/`
    const tts = await module.PhononTTS.load({
      lang: 'en',
      quant: 'q8',
      // Main already verified and stored the files; the Cache API would keep a second copy.
      cache: false,
      model: {
        weights: { q8: `${model}model.q8.gguf` },
        tokenizer: `${model}tokenizer.json`,
        config: `${model}config.json`,
        voices: { default: `${model}default-voice.safetensors` },
        defaultVoice: 'default'
      },
      ...options,
      wasmUrl: `${ORIGIN}/runtime/wasm/phonon_tts_bg.wasm`,
      threadsWasmUrl: `${ORIGIN}/runtime/wasm-threads/phonon_tts_bg.wasm`
    })
    phonon = { tts, key }
    return tts
  })()
  phononLoading = run
  try {
    return await run
  } finally {
    if (phononLoading === run) phononLoading = null
  }
}

async function phononVoice(tts: PhononInstance, voice: SpeakCommand['voice']): Promise<string> {
  if (voice.id === 'default' || !/^[\w-]{1,40}$/.test(voice.id)) return 'default'
  if (!tts.voices.includes(voice.id)) await tts.addVoice(voice.id, `${ORIGIN}/model/${voice.file}`)
  return voice.id
}

// ---------------------------------------------------------------------------
// Media Session: Web Audio alone doesn't make Chromium create one, so a silent looping <audio>
// claims it while a reading plays (hardware keys, Now Playing). Real audio goes through Web Audio.

let silentAudio: HTMLAudioElement | null = null

function silentWavUrl(): string {
  const rate = 8000
  const samples = rate
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const write = (offset: number, text: string): void => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); write(8, 'WAVE'); write(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples * 2, true)
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function mediaSessionPlaying(title: string, playing: boolean): void {
  if (!silentAudio) {
    silentAudio = new Audio(silentWavUrl())
    silentAudio.loop = true
  }
  const session = navigator.mediaSession
  if (session) {
    session.metadata = new MediaMetadata({ title: title || 'Read Aloud', artist: 'Surffish Read Aloud' })
    session.playbackState = playing ? 'playing' : 'paused'
  }
  if (playing) void silentAudio.play().catch(() => undefined)
  else silentAudio.pause()
}

/** A reading ended: drop the silent element (and its blob) so nothing holds the Media Session. */
function mediaSessionEnd(): void {
  const audio = silentAudio
  silentAudio = null
  if (audio) {
    audio.pause()
    const url = audio.src
    audio.removeAttribute('src')
    audio.load()
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }
  if (navigator.mediaSession) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
  }
}

// ---------------------------------------------------------------------------
// Readings

interface Reading {
  readonly token: number
  readonly engine: EngineId
  pause(): void
  resume(): void
  jump(index: number): void
  current(): number
  stop(): void
}

let reading: Reading | null = null
let audioContext: AudioContext | null = null

function context(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext({ latencyHint: 'playback' })
  return audioContext
}

/** Nothing playing: close the AudioContext so the output device and its audio thread are released. */
function releaseAudio(): void {
  const ctx = audioContext
  audioContext = null
  if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
}

/** A stream of mono float PCM chunks for sentence `index`. */
type Generate = (index: number, signal: AbortSignal) => AsyncIterable<Float32Array>

/** Phonon and the OpenAI-compatible server: chunks scheduled on the Web Audio clock. */
function streamedReading(command: SpeakCommand, engine: EngineId, generate: Generate, sampleRate: number, stats: Record<string, unknown>): Reading {
  const ctx = context()
  const output = ctx.createGain()
  output.connect(ctx.destination)
  const plan = new ReadAloudPlan(command.sentences.length, command.start, Math.max(1, Math.min(4, command.lookahead ?? 1)))
  const sources = new Set<AudioBufferSourceNode>()
  const started = performance.now()
  let abort: AbortController | null = null
  let paused = false
  let stopped = false
  let failures = 0
  let firstAudioMs: number | null = null
  let lastIndex = -1
  let statsSent = false
  // Real-time factor: time spent generating vs seconds of audio generated.
  let generateMs = 0
  let audioSeconds = 0
  const finalStats = (): Record<string, unknown> => ({ ...stats, firstAudioMs, generateMs: Math.round(generateMs), audioSeconds: Math.round(audioSeconds * 1000) / 1000 })

  const stopSources = (): void => {
    for (const source of sources) {
      try { source.stop() } catch { /* already stopped */ }
      source.disconnect()
    }
    sources.clear()
  }

  const report = (status: 'playing' | 'paused', index: number): void => {
    const withStats = !statsSent && firstAudioMs !== null
    if (withStats) statsSent = true
    emit({ type: 'state', token: command.token, status, index, engine, fallbackReason: command.fallbackReason ?? '', ...(withStats ? { stats: { ...stats, firstAudioMs } } : {}) })
  }

  const pump = (): void => {
    if (stopped) return
    const index = plan.nextToGenerate(ctx.currentTime, MAX_AHEAD_S)
    if (index === null) return
    const generation = plan.generation
    const controller = new AbortController()
    abort = controller
    let at = plan.startTimeFor(index, ctx.currentTime + 0.05, SENTENCE_GAP_S)
    plan.beginGenerating(index, at)
    let scheduled = false
    const generationStarted = performance.now()
    void (async () => {
      try {
        for await (const pcm of generate(index, controller.signal)) {
          if (stopped || generation !== plan.generation) return
          if (pcm.length === 0) continue
          const buffer = ctx.createBuffer(1, pcm.length, sampleRate)
          buffer.getChannelData(0).set(pcm)
          const source = ctx.createBufferSource()
          source.buffer = buffer
          source.connect(output)
          at = Math.max(at, ctx.currentTime + 0.01)
          source.start(at)
          at += buffer.duration
          audioSeconds += buffer.duration
          sources.add(source)
          source.onended = () => { sources.delete(source); source.disconnect() }
          if (firstAudioMs === null) firstAudioMs = Math.round(performance.now() - started)
          scheduled = true
        }
        if (stopped || generation !== plan.generation) return
        generateMs += performance.now() - generationStarted
        if (scheduled) {
          failures = 0
          plan.finishGenerating(index, at)
        } else {
          plan.failGenerating(index)
        }
      } catch (error) {
        if (stopped || generation !== plan.generation) return
        console.warn('[read aloud] sentence failed:', error)
        plan.failGenerating(index)
        failures += 1
        if (failures >= MAX_FAILURES_IN_A_ROW) {
          stop()
          releaseAudio()
          emit({ type: 'state', token: command.token, status: 'error', error: error instanceof Error ? error.message : String(error) })
          return
        }
      } finally {
        if (abort === controller) abort = null
      }
      pump()
    })()
  }

  const tick = (): void => {
    if (stopped || paused) return
    const result = plan.tick(ctx.currentTime)
    if (result.finished) {
      stop()
      releaseAudio()
      emit({ type: 'state', token: command.token, status: 'finished', stats: finalStats() })
      return
    }
    // Report a sentence once its audio has started (not while the first one is still generating).
    if ((result.index !== lastIndex) && firstAudioMs !== null) {
      report('playing', result.index)
      lastIndex = result.index
    }
    pump()
  }

  // The clock only runs while audio plays: paused, nothing ticks.
  let timer: ReturnType<typeof setInterval> | null = setInterval(tick, TICK_MS)
  const startTicking = (): void => { timer ??= setInterval(tick, TICK_MS) }
  const stopTicking = (): void => {
    if (timer) clearInterval(timer)
    timer = null
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    stopTicking()
    abort?.abort()
    stopSources()
    output.disconnect()
    mediaSessionEnd()
  }

  void ctx.resume().catch(() => undefined)
  mediaSessionPlaying(command.title, true)
  pump()

  return {
    token: command.token,
    engine,
    pause() {
      if (paused || stopped) return
      paused = true
      stopTicking()
      void ctx.suspend()
      mediaSessionPlaying(command.title, false)
      report('paused', plan.current)
    },
    resume() {
      if (!paused || stopped) return
      paused = false
      startTicking()
      void ctx.resume()
      mediaSessionPlaying(command.title, true)
      report('playing', plan.current)
    },
    jump(index: number) {
      if (stopped) return
      abort?.abort()
      stopSources()
      plan.jump(index)
      lastIndex = -1
      firstAudioMs = firstAudioMs ?? 0
      if (paused) {
        paused = false
        startTicking()
        void ctx.resume()
        mediaSessionPlaying(command.title, true)
      }
      pump()
    },
    current: () => plan.current,
    stop
  }
}

/** System voices (Chromium speechSynthesis): the fallback when Phonon can't start. */
function systemReading(command: SpeakCommand): Reading {
  const synth = window.speechSynthesis
  let index = Math.max(0, Math.min(command.sentences.length - 1, command.start))
  let generation = 0
  let stopped = false
  let paused = false
  const started = performance.now()
  let voicesReadyMs: number | null = null
  let firstAudioMs: number | null = null
  const stats = (): Record<string, unknown> => ({ loadMs: voicesReadyMs, cold: false, firstAudioMs })
  const voice = (): SpeechSynthesisVoice | null => {
    const voices = synth.getVoices()
    return voices.find((candidate) => candidate.default && candidate.lang.startsWith('en')) ?? voices.find((candidate) => candidate.lang.startsWith('en')) ?? voices[0] ?? null
  }
  const speak = (): void => {
    if (stopped) return
    if (index >= command.sentences.length) {
      stop()
      emit({ type: 'state', token: command.token, status: 'finished', stats: stats() })
      return
    }
    const mine = ++generation
    const utterance = new SpeechSynthesisUtterance(command.sentences[index])
    utterance.rate = command.speed
    const chosen = voice()
    if (chosen) utterance.voice = chosen
    utterance.onstart = () => {
      if (mine !== generation) return
      const first = firstAudioMs === null
      if (first) firstAudioMs = Math.round(performance.now() - started)
      emit({ type: 'state', token: command.token, status: 'playing', index, engine: 'system', fallbackReason: command.fallbackReason ?? '', ...(first ? { stats: stats() } : {}) })
    }
    utterance.onend = () => {
      if (mine !== generation || stopped) return
      index += 1
      speak()
    }
    utterance.onerror = (event) => {
      if (mine !== generation || stopped || event.error === 'interrupted' || event.error === 'canceled') return
      stop()
      emit({ type: 'state', token: command.token, status: 'error', error: synth.getVoices().length === 0 ? 'No system voices are available.' : `System speech failed (${event.error}).` })
    }
    synth.speak(utterance)
  }
  function stop(): void {
    if (stopped) return
    stopped = true
    generation += 1
    synth.cancel()
    mediaSessionEnd()
  }
  synth.cancel()
  mediaSessionPlaying(command.title, true)
  // Voices load asynchronously; a system with none (common on Linux without speech-dispatcher) never
  // fires an error for speak(), so say so instead of sitting silent.
  const begin = (): void => {
    if (stopped) return
    if (synth.getVoices().length > 0) {
      voicesReadyMs = Math.round(performance.now() - started)
      speak()
      return
    }
    stop()
    emit({ type: 'state', token: command.token, status: 'error', error: 'No system voices are available.' })
  }
  if (synth.getVoices().length > 0) {
    voicesReadyMs = Math.round(performance.now() - started)
    speak()
  } else {
    const timer = setTimeout(begin, 1500)
    synth.addEventListener('voiceschanged', () => { clearTimeout(timer); begin() }, { once: true })
  }
  return {
    token: command.token,
    engine: 'system',
    pause() {
      if (paused || stopped) return
      paused = true
      synth.pause()
      mediaSessionPlaying(command.title, false)
      emit({ type: 'state', token: command.token, status: 'paused', index, engine: 'system', fallbackReason: command.fallbackReason ?? '' })
    },
    resume() {
      if (!paused || stopped) return
      paused = false
      synth.resume()
      mediaSessionPlaying(command.title, true)
      emit({ type: 'state', token: command.token, status: 'playing', index, engine: 'system', fallbackReason: command.fallbackReason ?? '' })
    },
    jump(next: number) {
      if (stopped) return
      index = Math.max(0, Math.min(command.sentences.length - 1, next))
      paused = false
      generation += 1
      synth.cancel()
      speak()
    },
    current: () => index,
    stop
  }
}

async function start(command: SpeakCommand): Promise<void> {
  reading?.stop()
  reading = null
  const token = command.token
  const stillCurrent = (): boolean => latestToken === token
  emit({ type: 'state', token, status: 'loading', index: command.start, engine: command.engine })
  if (command.engine === 'openai') {
    const generate: Generate = async function* (index) {
      const result = await bridge!.speech(command.sentences[index] ?? '')
      if (!result.ok) throw new Error(result.error)
      yield pcm16ToFloat32(result.pcm)
    }
    reading = streamedReading(command, 'openai', generate, 24000, {})
    return
  }
  if (command.engine === 'phonon') {
    const loadStarted = performance.now()
    const cold = !(phonon && phonon.key === loadOptions(command).key)
    try {
      const tts = await loadPhonon(command)
      const voice = await phononVoice(tts, command.voice)
      if (!stillCurrent()) return
      const stretch = typeof command.stretch === 'number' && command.stretch > 0 ? command.stretch : 1
      const speechOptions = {
        voice,
        ...(typeof command.temperature === 'number' ? { temperature: command.temperature } : {}),
        ...(typeof command.seed === 'number' ? { seed: command.seed } : {})
      }
      const generate: Generate = async function* (index, signal) {
        const speech = tts.stream(command.sentences[index] ?? '', { ...speechOptions, signal })
        // Past what duration_delta reaches: WSOLA keeps the pitch (no chipmunk), per sentence.
        const stretcher = new WsolaStretcher(stretch, tts.sampleRate)
        try {
          for await (const pcm of speech) yield stretcher.push(pcm)
          yield stretcher.flush()
        } finally {
          if (signal.aborted) speech.cancel()
        }
      }
      const stats = { loadMs: Math.round(performance.now() - loadStarted), cold, threads: tts.threads, threadsReason: tts.threadsReason, device: tts.device, deviceReason: tts.deviceReason ?? '', isolated: self.crossOriginIsolated === true }
      reading = streamedReading(command, 'phonon', generate, tts.sampleRate, stats)
      return
    } catch (error) {
      if (!stillCurrent()) return
      console.warn('[read aloud] Phonon could not start, using system voices:', error)
      command = { ...command, fallbackReason: `Phonon could not start: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  reading = systemReading(command)
}

let latestToken = 0

async function readPdfText(id: number, bytes: Uint8Array): Promise<void> {
  try {
    const { extractPdfText } = await import('./pdf-text')
    const text = await extractPdfText(bytes)
    emit({ type: 'pdf-text', id, ok: true, ...text })
  } catch (error) {
    emit({ type: 'pdf-text', id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

bridge?.onCommand((command) => {
  if (command.type === 'pdf-text') {
    void readPdfText(command.id, command.bytes)
    return
  }
  if (command.type === 'stop') {
    latestToken = 0
    reading?.stop()
    reading = null
    releaseAudio()
    return
  }
  if (command.type === 'speak' || command.type === 'respeak') {
    latestToken = command.token
    void start(command)
    return
  }
  if (command.type === 'control' && reading && reading.token === command.token) {
    if (command.action === 'pause') reading.pause()
    else if (command.action === 'resume') reading.resume()
    else if (command.action === 'next') reading.jump(reading.current() + 1)
    else if (command.action === 'previous') reading.jump(Math.max(0, reading.current() - 1))
  }
})

// Hardware media keys / Now Playing. Stop ends the reading in main too.
if (navigator.mediaSession) {
  const session = navigator.mediaSession
  const tokenNow = (): number => reading?.token ?? 0
  session.setActionHandler('play', () => reading?.resume())
  session.setActionHandler('pause', () => reading?.pause())
  session.setActionHandler('nexttrack', () => { if (reading) reading.jump(reading.current() + 1) })
  session.setActionHandler('previoustrack', () => { if (reading) reading.jump(Math.max(0, reading.current() - 1)) })
  session.setActionHandler('stop', () => {
    const token = tokenNow()
    reading?.stop()
    reading = null
    releaseAudio()
    if (token) emit({ type: 'state', token, status: 'finished' })
  })
}

emit({ type: 'ready' })
