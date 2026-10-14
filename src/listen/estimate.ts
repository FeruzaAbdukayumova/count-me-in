import { analyze } from '../analysis/analyze'
import type { Estimate } from './follow'

/** The 1 is trusted when its bass swell beats the runner-up by this much. */
const SURE_MARGIN = 1.25

/** Below this RMS the microphone is hearing a quiet room, not music. */
export const QUIET_RMS = 0.004

export function rms(samples: Float32Array): number {
  let s = 0
  for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i]
  return Math.sqrt(s / Math.max(1, samples.length))
}

/**
 * One beat estimate from a window of microphone audio that started at `startTime` on the
 * AudioContext clock. Null when the window is too quiet to be music.
 */
export function estimateWindow(samples: Float32Array, sampleRate: number, startTime: number): Estimate | null {
  if (rms(samples) < QUIET_RMS) return null
  const r = analyze(samples, sampleRate)
  // the grid is fitted to the whole window, so a small tempo error throws its edges out the
  // most; the 1 nearest the middle is the one to trust
  const cycle = (8 * 60) / r.bpm
  const middle = samples.length / sampleRate / 2
  const one = r.anchor + Math.round((middle - r.anchor) / cycle) * cycle
  return {
    bpm: r.bpm,
    one: startTime + one,
    sure: r.downbeatMargin >= SURE_MARGIN,
    checked: r.tempoChecked,
    claps: r.hits[1].map((h) => startTime + h.t),
  }
}
