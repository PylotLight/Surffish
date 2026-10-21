/**
 * Pitch-preserving time stretch (WSOLA, waveform-similarity overlap-add) for Read Aloud above what
 * Phonon's own speed conditioner reaches (read-aloud-speed.ts). Streaming: feed it the model's 80 ms
 * chunks as they arrive, get shorter chunks back, `flush()` at the end of a sentence. Speeding up
 * by resampling (playbackRate) would raise the pitch; WSOLA drops/repeats whole pitch periods
 * instead, picking each next grain where the waveform lines up with the natural continuation of the
 * previous one, so 2–3× stays intelligible. Pure and allocation-light; runs in the engine page.
 */

export interface StretchOptions {
  /** Grain length in samples (default 25 ms at the sample rate). Overlap is half of it. */
  frame?: number
  /** How far (samples) a grain may move from its nominal position to line up (default 6 ms). */
  tolerance?: number
}

export class WsolaStretcher {
  /** Output is `rate` times shorter (2 = twice as fast). */
  readonly rate: number
  private readonly frame: number
  private readonly hop: number
  private readonly tolerance: number
  private readonly window: Float32Array
  /** Input not yet consumed; `inputBase` is the absolute index of input[0]. */
  private input = new Float32Array(0)
  private inputLength = 0
  private inputBase = 0
  private totalIn = 0
  /** Grains placed so far, and where the last one started in the input (absolute). */
  private grains = 0
  private previousStart = -1
  /** Overlap-add tail carried into the next grain (`hop` samples). */
  private tail: Float32Array
  private flushed = false

  constructor(rate: number, sampleRate = 24000, options: StretchOptions = {}) {
    this.rate = Number.isFinite(rate) && rate > 0 ? rate : 1
    const frame = Math.max(64, Math.round(options.frame ?? sampleRate * 0.025))
    this.frame = frame - (frame % 2)
    this.hop = this.frame / 2
    this.tolerance = Math.max(0, Math.round(options.tolerance ?? sampleRate * 0.006))
    this.window = new Float32Array(this.frame)
    // Periodic Hann: two half-overlapped windows sum to exactly 1.
    for (let index = 0; index < this.frame; index += 1) this.window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / this.frame)
    this.tail = new Float32Array(this.hop)
  }

  /** Rate 1 needs no work: chunks pass through untouched. */
  get passthrough(): boolean {
    return Math.abs(this.rate - 1) < 0.001
  }

  private append(chunk: Float32Array): void {
    const needed = this.inputLength + chunk.length
    if (needed > this.input.length) {
      const grown = new Float32Array(Math.max(needed, this.input.length * 2, 4096))
      grown.set(this.input.subarray(0, this.inputLength))
      this.input = grown
    }
    this.input.set(chunk, this.inputLength)
    this.inputLength = needed
    this.totalIn += chunk.length
  }

  /** Input sample at absolute index (0 past the end: the last grains fade out over silence). */
  private at(absolute: number): number {
    const index = absolute - this.inputBase
    return index >= 0 && index < this.inputLength ? this.input[index]! : 0
  }

  /** Where grain `k` starts in the input: its nominal place, nudged to line up with the last grain. */
  private grainStart(k: number, end: number): number {
    const nominal = Math.round(k * this.hop * this.rate)
    if (this.previousStart < 0 || this.tolerance === 0) return nominal
    // The natural continuation of the previous grain is what a seamless join would play next.
    const natural = this.previousStart + this.hop
    const low = Math.max(this.inputBase, nominal - this.tolerance)
    const high = Math.min(end - this.frame, nominal + this.tolerance)
    if (high < low) return Math.max(this.inputBase, Math.min(nominal, end - this.frame))
    let best = Math.max(low, Math.min(nominal, high))
    let bestScore = -Infinity
    const span = this.hop
    for (let candidate = low; candidate <= high; candidate += 1) {
      let dot = 0
      let energy = 1e-9
      // Every other sample is plenty for speech at 24 kHz and halves the cost.
      for (let index = 0; index < span; index += 2) {
        const value = this.at(candidate + index)
        dot += value * this.at(natural + index)
        energy += value * value
      }
      const score = dot / Math.sqrt(energy)
      if (score > bestScore) {
        bestScore = score
        best = candidate
      }
    }
    return best
  }

  /** Place every grain whose input (plus search room) has arrived; `end` = input available. */
  private run(end: number, final: boolean): Float32Array {
    const chunks: Float32Array[] = []
    while (true) {
      const nominal = Math.round(this.grains * this.hop * this.rate)
      if (final ? nominal >= end : nominal + this.tolerance + this.frame > end || this.previousStart + this.hop + this.hop > end) break
      const start = this.grainStart(this.grains, final ? Math.max(end, nominal + this.frame) : end)
      const out = new Float32Array(this.hop)
      for (let index = 0; index < this.hop; index += 1) {
        out[index] = this.tail[index]! + this.at(start + index) * this.window[index]!
        this.tail[index] = this.at(start + this.hop + index) * this.window[this.hop + index]!
      }
      chunks.push(out)
      this.previousStart = start
      this.grains += 1
      // Drop input no future grain can reach.
      const keepFrom = Math.min(Math.round(this.grains * this.hop * this.rate) - this.tolerance, this.previousStart + this.hop)
      const drop = keepFrom - this.inputBase
      if (drop > 0 && drop <= this.inputLength) {
        this.input.copyWithin(0, drop, this.inputLength)
        this.inputLength -= drop
        this.inputBase += drop
      }
    }
    if (final) {
      chunks.push(this.tail.slice())
      this.tail.fill(0)
    }
    return concat(chunks)
  }

  /** Feed a chunk of input; returns the stretched audio ready so far (may be empty). */
  push(chunk: Float32Array): Float32Array {
    if (this.flushed) throw new Error('WsolaStretcher: push after flush')
    if (this.passthrough) return chunk
    this.append(chunk)
    return this.run(this.inputBase + this.inputLength, false)
  }

  /** End of the input: the rest of the audio, trimmed to the stretched length. */
  flush(): Float32Array {
    if (this.flushed) return new Float32Array(0)
    this.flushed = true
    if (this.passthrough) return new Float32Array(0)
    const produced = this.grains * this.hop
    const rest = this.run(this.inputBase + this.inputLength, true)
    // Total output ≈ input / rate; the tail grain over the zero padding is cut back to that.
    const wanted = Math.max(0, Math.round(this.totalIn / this.rate) - produced)
    return rest.length > wanted ? rest.subarray(0, wanted) : rest
  }
}

function concat(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 1) return chunks[0]!
  let length = 0
  for (const chunk of chunks) length += chunk.length
  const out = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Stretch a whole buffer at once (tests, the tester's WAV export if ever needed). */
export function stretchAll(pcm: Float32Array, rate: number, sampleRate = 24000, options?: StretchOptions): Float32Array {
  const stretcher = new WsolaStretcher(rate, sampleRate, options)
  if (stretcher.passthrough) return pcm
  return concat([stretcher.push(pcm), stretcher.flush()])
}
