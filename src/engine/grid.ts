/** Pure timing math for the 8-count. Everything here is in seconds of song time. */

export const CYCLE = 8
export const MIN_BPM = 30
export const MAX_BPM = 260
export const MAX_OFFSET_MS = 400

export type Focus = 'all' | 'onefive' | 'one'

export interface Grid {
  bpm: number
  /** Song time of a "1". */
  anchor: number
  /** Manual nudge, added to the anchor. */
  offsetMs: number
}

export const beatLength = (g: Grid) => 60 / g.bpm
export const cycleLength = (g: Grid) => beatLength(g) * CYCLE
/** Where a "1" really is, nudge included. */
export const effectiveAnchor = (g: Grid) => g.anchor + g.offsetMs / 1000

/** Index of the beat playing at `t`, counted from the anchor (negative before it). */
export const beatIndexAt = (g: Grid, t: number) => Math.floor((t - effectiveAnchor(g)) / beatLength(g))

/** 0–7 for any beat index, including negative ones. */
export const countOf = (i: number) => ((i % CYCLE) + CYCLE) % CYCLE

/** How far through the current 8-count `t` is, 0–1. */
export function cycleProgress(g: Grid, t: number): number {
  const u = (t - effectiveAnchor(g)) / cycleLength(g)
  return u - Math.floor(u)
}

export function isFocused(focus: Focus, count: number): boolean {
  if (focus === 'one') return count === 0
  if (focus === 'onefive') return count === 0 || count === 4
  return true
}

export const clampBpm = (bpm: number) => Math.min(MAX_BPM, Math.max(MIN_BPM, bpm))
export const clampOffset = (ms: number) => Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, ms))

/** Where the counting should restart after the "count me in" lead-in: the nearest 1 at or after 0. */
export function nearestOne(g: Grid, t: number, duration: number): number {
  const cyc = cycleLength(g)
  let snap = effectiveAnchor(g) + Math.round((t - effectiveAnchor(g)) / cyc) * cyc
  while (snap < 0) snap += cyc
  return Math.min(snap, Math.max(0, duration - 0.05))
}

/** Taps further apart than this start a fresh tempo. */
export const TAP_RESET_SECONDS = 2.4
export const TAPS_NEEDED = 4

/**
 * Tempo from a few taps. Ignores a tap that's way off (more than ~a third of a beat out),
 * then folds the result into a countable range — tapping every other beat still works.
 */
export function tempoFromTaps(taps: number[]): number | null {
  if (taps.length < 2) return null
  const intervals: number[] = []
  for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
  const sorted = intervals.slice().sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let keep = intervals.filter((v) => Math.abs(v - median) < median * 0.32)
  if (!keep.length) keep = [median]
  const beat = keep.reduce((a, b) => a + b, 0) / keep.length
  // taps that all landed at the same instant (a suspended audio clock doesn't move) carry no
  // tempo; without this check the folding loop below would halve Infinity forever
  if (!(beat > 0.05) || !Number.isFinite(beat)) return null
  let bpm = 60 / beat
  while (bpm < 55) bpm *= 2
  while (bpm > 210) bpm /= 2
  return bpm
}
