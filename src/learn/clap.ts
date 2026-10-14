/**
 * The clap lesson: the clap comes back on the same counts in every 8 (2, 4, 6 and 8 in many
 * songs, 3 and 7 in a lot of hip hop), so hearing it tells you where you are. Pure, so it's
 * tested without a microphone. Times are on the AudioContext clock, in seconds.
 */
import { beatLength, countOf, effectiveAnchor, type Grid } from '../engine/grid'

/** A clap this far from a beat (as a fraction of a beat) isn't on any count. */
const ON_BEAT = 0.18
/** Fewer claps than this on the counts and there's no pattern to teach. */
const MIN_CLAPS = 6
/** The clap's place has to get this many times more claps than the other places. */
const CLEAR = 1.4

/**
 * The counts (0–7) the claps keep landing on: [2, 6] for 3 and 7, [1, 3, 5, 7] for the even
 * numbers, or null when neither is clear.
 *
 * The clap pattern repeats every 4 counts, so counts 4 apart are added together. That also
 * makes it the same whether our 1 is the real 1 or the 5. A clap almost never lands on the 1
 * or the 5, and through a small speaker the deep boom loses its low end and gets heard as a
 * clap, so those counts are left out.
 */
export function clapCounts(claps: number[], grid: Grid): number[] | null {
  const beat = beatLength(grid)
  const anchor = effectiveAnchor(grid)
  const place = [0, 0, 0, 0]
  for (const t of claps) {
    const k = (t - anchor) / beat
    const n = Math.round(k)
    if (Math.abs(k - n) <= ON_BEAT) place[countOf(n) % 4]++
  }
  const [, two, three, four] = place
  if (two + three + four < MIN_CLAPS) return null
  if (three >= CLEAR * Math.max(two, four)) return [2, 6]
  if (Math.min(two, four) >= CLEAR * three) return [1, 3, 5, 7]
  return null
}

/** "3 and 7", "2, 4, 6 and 8": counts 0–7 as the numbers a dancer says. */
export function sayCounts(counts: number[]): string {
  const n = counts.map((c) => String(c + 1))
  return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]
}

/** A tap this close to the clap is on it. */
const HIT_SECONDS = 0.14
/** A clap nobody tapped for this long after it has been missed. */
const MISS_AFTER = 0.35

export type TapResult =
  | { kind: 'hit'; count: number }
  | { kind: 'early' | 'late'; count: number }
  /** Tapped on a count with no clap. */
  | { kind: 'wrong'; count: number }

interface Moment {
  t: number
  count: number
  done: boolean
}

/** One "tap on every clap" round: `total` claps, each one hit, tapped off time, or missed. */
export class ClapRound {
  readonly total: number
  private pattern: number[]
  private moments: Moment[] = []
  hits = 0

  constructor(pattern: number[], total = 8) {
    this.pattern = pattern
    this.total = total
  }

  /** How many of the round's claps have gone by. */
  get heard() {
    return this.moments.length
  }

  /** A beat started at `t` on `count`. The same beat may be reported more than once. */
  beat(t: number, count: number, beatLen: number) {
    if (!this.pattern.includes(count) || this.moments.length >= this.total) return
    if (this.moments.some((m) => Math.abs(m.t - t) < beatLen / 2)) return
    this.moments.push({ t, count, done: false })
  }

  tap(t: number, grid: Grid): TapResult | null {
    const beat = beatLength(grid)
    const n = Math.round((t - effectiveAnchor(grid)) / beat)
    const at = effectiveAnchor(grid) + n * beat
    const count = countOf(n)
    if (!this.pattern.includes(count)) return { kind: 'wrong', count }
    // a tap a little before the clap arrives before the frame that would have reported it
    this.beat(at, count, beat)
    const m = this.moments.find((m) => Math.abs(m.t - at) < beat / 2)
    if (!m || m.done) return null
    m.done = true
    const off = t - at
    if (Math.abs(off) <= HIT_SECONDS) {
      this.hits++
      return { kind: 'hit', count }
    }
    return { kind: off < 0 ? 'early' : 'late', count }
  }

  /** Claps that went by untapped since the last call. */
  missed(now: number): number[] {
    const out: number[] = []
    for (const m of this.moments) {
      if (!m.done && now > m.t + MISS_AFTER) {
        m.done = true
        out.push(m.count)
      }
    }
    return out
  }

  /** Every clap in the round has been heard and dealt with. */
  get finished() {
    return this.moments.length >= this.total && this.moments.every((m) => m.done)
  }
}
