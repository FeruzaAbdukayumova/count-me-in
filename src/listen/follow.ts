/**
 * Turns a stream of noisy beat estimates (one every couple of seconds, each from the last few
 * seconds of microphone audio) into a steady count. Pure, so it's tested without a microphone.
 *
 * Two jobs, kept strictly apart:
 *  - finding: wait until two windows agree on the beat, then lock;
 *  - holding: once locked, the count never jumps. Later windows nudge it by a few
 *    milliseconds and trim the tempo, but they never move the 1 or switch the tempo. A
 *    wrong reading in a busy bit of the song then costs nothing. The dancer fixes a wrong 1
 *    with one tap, and starts the finding again for a new song.
 *
 * Times are on the AudioContext clock, in seconds.
 */

/** What one window of audio says: the tempo, and the time of a 1 inside that window. */
export interface Estimate {
  bpm: number
  one: number
  /** Whether the audio clearly says this is the 1, rather than just a beat. */
  sure?: boolean
  /** False when the window was too short to check the tempo properly: it can't start a lock. */
  checked?: boolean
  /** Times of the claps heard in the window. */
  claps?: number[]
}

export interface Lock {
  bpm: number
  /** Time of a 1. */
  anchor: number
}

export type FollowStatus = 'listening' | 'locked'

/** Two estimates agree on the tempo when they're this close (as a fraction). */
const BPM_TOLERANCE = 0.03
/** …and on where the beats fall when they're within this much of a beat. */
const PHASE_TOLERANCE = 0.14
/** How much of each agreeing estimate the lock takes on. Low, so one odd window can't jerk the count. */
const SMOOTHING = 0.3
/**
 * A lock needs two agreeing estimates among this many recent ones. Fast hi-hat rolls fool
 * the odd window into a wrong tempo, so requiring two in a row would wait for a lucky streak.
 */
const RECENT = 4
/**
 * This many windows in a row that agree with each other but not with the lock means the
 * music has probably changed. The count carries on regardless; the dancer gets told.
 */
const STRANGERS_TO_DOUBT = 8

const mod = (n: number, m: number) => ((n % m) + m) % m

/** Where `est` falls against `lock`: its phase error in beats (−0.5…0.5) and which count its 1 is on. */
function compare(lock: Lock, est: Estimate) {
  const beat = 60 / lock.bpm
  const k = (est.one - lock.anchor) / beat
  const nearest = Math.round(k)
  return { phase: k - nearest, count: mod(nearest, 8), beats: nearest }
}

function agreesOnBeat(lock: Lock, est: Estimate): boolean {
  if (Math.abs(est.bpm / lock.bpm - 1) > BPM_TOLERANCE) return false
  return Math.abs(compare(lock, est).phase) <= PHASE_TOLERANCE
}

export class BeatFollower {
  status: FollowStatus = 'listening'
  lock: Lock | null = null
  /** The last several windows all disagreed with the lock: probably a different song by now. */
  doubt = false
  private recent: Estimate[] = []
  /** Estimates in a row that disagree with the lock but agree with each other. */
  private strangers: Estimate[] = []

  /** Takes one estimate. Returns the lock whenever it changes, otherwise null. */
  feed(est: Estimate): Lock | null {
    if (!(est.bpm > 0) || !Number.isFinite(est.one)) return null
    return this.lock ? this.hold(this.lock, est) : this.tryLock(est)
  }

  /** The dancer said "this is the 1": trust them over the microphone. */
  override(anchor: number) {
    if (!this.lock) return
    this.lock = { ...this.lock, anchor }
  }

  reset() {
    this.status = 'listening'
    this.lock = null
    this.doubt = false
    this.recent = []
    this.strangers = []
  }

  private tryLock(est: Estimate): Lock | null {
    const prev = this.recent.findLast((p) => agreesOnBeat({ bpm: p.bpm, anchor: p.one }, est))
    this.recent = [...this.recent, est].slice(-RECENT)
    if (!prev || est.checked === false) return null
    // two 1s several beats apart pin the tempo down better than either window's own reading
    const guess = (prev.bpm + est.bpm) / 2
    const span = est.one - prev.one
    const beats = Math.round((span * guess) / 60)
    const bpm = beats >= 4 ? (60 * beats) / span : guess
    this.lock = { bpm, anchor: est.one }
    this.status = 'locked'
    this.strangers = []
    this.doubt = false
    return this.lock
  }

  private hold(lock: Lock, est: Estimate): Lock | null {
    if (!agreesOnBeat(lock, est)) {
      // the run is judged on tempo alone: a window's beat position is the noisier reading
      const prev = this.strangers[this.strangers.length - 1]
      this.strangers = prev && Math.abs(est.bpm / prev.bpm - 1) <= BPM_TOLERANCE ? [...this.strangers, est] : [est]
      if (this.strangers.length >= STRANGERS_TO_DOUBT) this.doubt = true
      return null
    }
    this.strangers = []
    this.doubt = false
    const { phase, count, beats } = compare(lock, est)
    const beat = 60 / lock.bpm
    // the window's 1 may sit on any of our counts; only its distance from the nearest beat is
    // used. Moving the anchor up to the present (by whole 8s) keeps a tiny tempo error from
    // growing over the song.
    const anchor = lock.anchor + (beats - count) * beat + SMOOTHING * phase * beat
    this.lock = { bpm: lock.bpm + SMOOTHING * (est.bpm - lock.bpm), anchor }
    return this.lock
  }
}
