/**
 * Synthesises a drum loop whose pattern is known in advance, so the analysis can be
 * checked against ground truth. Tick (hi-hat) is on every half count; the rest depends on
 * the pattern:
 *  - 'halftime': BOOM (kick) on 1 and 5, CLAP (snare) on 3 and 7 — the slow hip hop feel.
 *  - 'backbeat': BOOM on 1, 3, 5, 7, CLAP on 2, 4, 6, 8 — the usual pop/dance groove.
 *
 * The sounds are spectrally realistic on purpose — a white-noise "hat" has low-frequency
 * content that real hi-hats don't, which makes the analysis look broken when it isn't.
 */
export type DrumPattern = 'halftime' | 'backbeat'

const PATTERNS: Record<DrumPattern, { boom: number[]; clap: number[] }> = {
  halftime: { boom: [0, 4], clap: [2, 6] },
  backbeat: { boom: [0, 2, 4, 6], clap: [1, 3, 5, 7] },
}

export interface DrumLoopOptions {
  bpm: number
  pattern?: DrumPattern
  /** How many 8-counts to generate. */
  eights?: number
  sampleRate?: number
  /** Silence before the first "1", in seconds. */
  leadIn?: number
  seed?: number
}

export function drumLoop({
  bpm,
  pattern = 'halftime',
  eights = 4,
  sampleRate: sr = 44100,
  leadIn = 0,
  seed = 11,
}: DrumLoopOptions): Float32Array {
  const beat = 60 / bpm
  const out = new Float32Array(Math.floor(sr * (leadIn + beat * 8 * eights)))
  const random = mulberry32(seed)
  const noise = (seconds: number) =>
    Float32Array.from({ length: Math.floor(sr * seconds) }, () => random() * 2 - 1)

  const lowpass = (sig: Float32Array, hz: number, times = 1) => {
    const a = 1 - Math.exp((-2 * Math.PI * hz) / sr)
    let s = sig
    for (let n = 0; n < times; n++) {
      const next = new Float32Array(s.length)
      let y = 0
      for (let i = 0; i < s.length; i++) next[i] = y += a * (s[i] - y)
      s = next
    }
    return s
  }
  const highpass = (sig: Float32Array, hz: number, times = 1) => {
    const low = lowpass(sig, hz, times)
    return sig.map((v, i) => v - low[i])
  }
  const decay = (sig: Float32Array, rate: number) => sig.map((v, i) => v * Math.exp((-i / sr) * rate))

  const kick = Float32Array.from({ length: Math.floor(sr * 0.3) }, (_, i) => {
    const t = i / sr
    return 0.95 * Math.exp(-t * 9) * Math.sin(2 * Math.PI * (115 * Math.exp(-t * 22) + 45) * t)
  })
  const snareBody = Float32Array.from({ length: Math.floor(sr * 0.18) }, (_, i) => {
    const t = i / sr
    return 0.38 * Math.exp(-t * 26) * Math.sin(2 * Math.PI * 190 * t)
  })
  const snareNoise = decay(lowpass(highpass(noise(0.18), 900, 2), 5000, 2), 30)
  const snare = snareBody.map((v, i) => v + 0.9 * snareNoise[i])
  const hat = decay(highpass(noise(0.05), 6000, 4), 150).map((v) => v * 0.5)

  const place = (at: number, sig: Float32Array) => {
    const start = Math.floor(at * sr)
    for (let i = 0; i < sig.length && start + i < out.length; i++) out[start + i] += sig[i]
  }
  for (let e = 0; e < eights; e++) {
    const base = leadIn + e * beat * 8
    for (const c of PATTERNS[pattern].boom) place(base + c * beat, kick)
    for (const c of PATTERNS[pattern].clap) place(base + c * beat, snare)
    for (let c = 0; c < 8; c++) {
      place(base + c * beat, hat)
      place(base + (c + 0.5) * beat, hat)
    }
  }

  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.89
  return out
}

/** Small seeded PRNG, so every test run hears exactly the same loop. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
