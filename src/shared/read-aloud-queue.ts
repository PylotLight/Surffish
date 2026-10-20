/**
 * Read Aloud playback plan: which sentence to generate next and which one is being heard. The
 * engine page streams one sentence's audio onto a Web Audio timeline while the sentence before it
 * plays (prefetch of `lookahead` sentences), and asks this plan, from the audio clock, which sentence
 * is audible (for the Reader view highlight and the player). Skips, stops and restarts bump
 * `generation`, so audio still arriving for an abandoned request is dropped. Pure, no timers.
 */

export interface PlannedSentence {
  /** Audio-clock time (s) its first sample plays. */
  start: number
  /** When its last sample ends; null while it is still being generated. */
  end: number | null
}

export interface PlanTick {
  /** The sentence heard at that time (or the next one due). */
  index: number
  /** `index` differs from the last tick. */
  changed: boolean
  /** Everything was spoken. */
  finished: boolean
}

export class ReadAloudPlan {
  readonly total: number
  readonly lookahead: number
  /** Bumped by every jump; a generation request compares it before scheduling audio. */
  generation = 0
  /** Sentence being heard (or the next one due when there is a gap). */
  current = 0
  private timeline = new Map<number, PlannedSentence>()
  private generating: number | null = null
  private failed = new Set<number>()

  constructor(total: number, start = 0, lookahead = 1) {
    this.total = Math.max(0, Math.floor(total))
    this.lookahead = Math.max(0, Math.floor(lookahead))
    this.current = this.clamp(start)
  }

  private clamp(index: number): number {
    if (this.total === 0) return 0
    return Math.min(this.total - 1, Math.max(0, Math.floor(index)))
  }

  /** Start over from `index` (skip, previous, speed or voice change): forget the timeline. */
  jump(index: number): number {
    this.generation += 1
    this.current = this.clamp(index)
    this.timeline.clear()
    this.failed.clear()
    this.generating = null
    return this.generation
  }

  isGenerating(): boolean {
    return this.generating !== null
  }

  /**
   * The next sentence to generate: nothing is being generated, it is not on the timeline yet, and it
   * is at most `lookahead` sentences past the one being heard. Null when there is nothing to do now.
   */
  nextToGenerate(): number | null {
    if (this.generating !== null || this.total === 0) return null
    for (let index = this.current; index < this.total && index <= this.current + this.lookahead; index += 1) {
      if (!this.timeline.has(index) && !this.failed.has(index)) return index
    }
    return null
  }

  /** Where sentence `index` should start: right after the one before it (plus `gap`), or `now`. */
  startTimeFor(index: number, now: number, gap = 0): number {
    const previous = this.timeline.get(index - 1)
    if (previous?.end != null) return Math.max(now, previous.end + gap)
    return now
  }

  beginGenerating(index: number, start: number): void {
    this.generating = index
    this.timeline.set(index, { start, end: null })
  }

  /** The sentence's audio is all scheduled; it ends at `end` on the audio clock. */
  finishGenerating(index: number, end: number): void {
    const entry = this.timeline.get(index)
    if (entry) entry.end = Math.max(entry.start, end)
    if (this.generating === index) this.generating = null
  }

  /** Generation failed or produced nothing: skip the sentence instead of stalling. */
  failGenerating(index: number): void {
    this.timeline.delete(index)
    this.failed.add(index)
    if (this.generating === index) this.generating = null
  }

  /** Last scheduled sample on the audio clock (0 when nothing is scheduled). */
  scheduledUntil(): number {
    let until = 0
    for (const entry of this.timeline.values()) until = Math.max(until, entry.end ?? entry.start)
    return until
  }

  /** Move `current` to the sentence audible at `time`. */
  tick(time: number): PlanTick {
    const before = this.current
    let index = this.current
    // Walk forward past sentences that have finished playing (or failed).
    while (index < this.total) {
      if (this.failed.has(index)) {
        index += 1
        continue
      }
      const entry = this.timeline.get(index)
      if (entry && entry.end !== null && time >= entry.end && this.generating !== index) {
        index += 1
        continue
      }
      break
    }
    const finished = index >= this.total
    this.current = finished ? Math.max(0, this.total - 1) : index
    return { index: this.current, changed: this.current !== before, finished: finished && this.total > 0 }
  }

  /** Index a skip forward goes to, or null at the last sentence. */
  nextIndex(): number | null {
    return this.current + 1 < this.total ? this.current + 1 : null
  }

  /** Index a skip back goes to (the start of the current sentence when it's the first). */
  previousIndex(): number {
    return Math.max(0, this.current - 1)
  }
}

/** Mono 16-bit little-endian PCM (an OpenAI-compatible server's `pcm` format) → float samples. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  const samples = new Float32Array(bytes.byteLength >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let index = 0; index < samples.length; index += 1) samples[index] = view.getInt16(index * 2, true) / 32768
  return samples
}
