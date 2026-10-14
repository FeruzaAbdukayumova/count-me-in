import type { Analysis, Hit } from './types'

/** Analysis runs at 200 frames per second. */
const FRAMES_PER_SECOND = 200
const MIN_BPM = 55
const MAX_BPM = 200
/** Tempo the search leans towards when two candidates score about the same. */
const PRIOR_BPM = 100
/** Nobody counts an 8 slower than this; a slower reading is almost always half the real pulse. */
const MIN_COUNTED_BPM = 62
/** Doubling never goes past this. */
const MAX_COUNTED_BPM = 160
const ENVELOPE_POINTS = 1600

interface Bands {
  fps: number
  frames: number
  full: Float32Array
  /** Boom range, below ~160 Hz. */
  low: Float32Array
  /** Clap range, ~260–1800 Hz. */
  mid: Float32Array
  /** Tick range, above ~4 kHz. */
  high: Float32Array
}

/**
 * Works out the tempo, where the "1" is, and every drum hit in a song.
 * Pure and synchronous, so it runs the same in a Web Worker and in tests.
 */
export function analyze(samples: Float32Array, sampleRate: number): Analysis {
  const bands = splitIntoBands(samples, sampleRate)
  const { frames, fps } = bands

  const onsets = {
    low: onsetStrength(bands.low),
    mid: onsetStrength(bands.mid),
    high: onsetStrength(bands.high),
    full: onsetStrength(bands.full),
  }
  const beatEnv = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    beatEnv[f] = 0.55 * onsets.low[f] + 0.3 * onsets.mid[f] + 0.15 * onsets.high[f]
  }

  const drums = new Float32Array(frames)
  for (let f = 0; f < frames; f++) drums[f] = 0.65 * onsets.low[f] + 0.35 * onsets.mid[f]
  const shapes = [onsets.low, onsets.mid, onsets.high].map((e) => smooth(e, SHAPE_FRAMES))
  const first = correctTriplet(findBeatGrid(beatEnv, fps), beatEnv, drums, shapes, fps)
  const tempoChecked = first.checked
  let { lag, offset: guess } = correctOctave(first, beatEnv, drums, fps)
  // nobody counts faster than this: a reading above it is the half-counts of a slower song
  if ((60 * fps) / lag > MAX_COUNTED_BPM) {
    lag *= 2
    guess = bestPhase(beatEnv, lag).offset
  }
  const offset = checkPhase(lag, guess, onsets.mid, onsets.high)
  const { downbeat, margin } = findDownbeat(bands.low, fps, lag, offset)
  const anchorFrame = offset + downbeat * lag

  const hits = findHits(bands, onsets)
  const boom = landsOn(hits[0], anchorFrame, lag)
  const clap = landsOn(hits[1], anchorFrame, lag)
  const evidence: string[] = []
  if (boom) evidence.push('the deep boom lands on ' + listOf(boom))
  if (clap) evidence.push('the clap lands on ' + listOf(clap))

  return {
    bpm: (60 * fps) / lag,
    anchor: anchorFrame / fps,
    downbeatMargin: margin,
    tempoChecked,
    envelope: overview(bands.full, frames),
    hits,
    evidence: evidence.length ? 'In this song ' + evidence.join(', and ') + '.' : '',
  }
}

/** Mixes any number of channels down to one, the way the analysis expects. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(channels[0].length)
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i]
  for (let i = 0; i < out.length; i++) out[i] /= channels.length
  return out
}

/**
 * RMS loudness per frame in four bands, using cascaded one-pole filters
 * (cheap, and steep enough at four poles to keep booms and ticks apart).
 */
function splitIntoBands(x: Float32Array, sampleRate: number): Bands {
  const hop = Math.max(1, Math.round(sampleRate / FRAMES_PER_SECOND))
  const fps = sampleRate / hop
  const frames = Math.floor(x.length / hop)
  const full = new Float32Array(frames)
  const low = new Float32Array(frames)
  const mid = new Float32Array(frames)
  const high = new Float32Array(frames)

  const coef = (hz: number) => 1 - Math.exp((-2 * Math.PI * hz) / sampleRate)
  const aLow = coef(160)
  const aMidUpper = coef(1800)
  const aMidLower = coef(260)
  const aHigh = coef(4000)

  let p1 = 0, p2 = 0, p3 = 0, p4 = 0
  let u1 = 0, u2 = 0, u3 = 0, u4 = 0
  let d1 = 0, d2 = 0, d3 = 0, d4 = 0
  let h1 = 0, h2 = 0, h3 = 0, h4 = 0
  let i = 0
  for (let f = 0; f < frames; f++) {
    let sf = 0, sl = 0, sm = 0, sh = 0
    for (const end = i + hop; i < end; i++) {
      const s = x[i]
      sf += s * s
      p1 += aLow * (s - p1); p2 += aLow * (p1 - p2); p3 += aLow * (p2 - p3); p4 += aLow * (p3 - p4)
      sl += p4 * p4
      u1 += aMidUpper * (s - u1); u2 += aMidUpper * (u1 - u2); u3 += aMidUpper * (u2 - u3); u4 += aMidUpper * (u3 - u4)
      d1 += aMidLower * (s - d1); d2 += aMidLower * (d1 - d2); d3 += aMidLower * (d2 - d3); d4 += aMidLower * (d3 - d4)
      const m = u4 - d4
      sm += m * m
      h1 += aHigh * (s - h1); h2 += aHigh * (h1 - h2); h3 += aHigh * (h2 - h3); h4 += aHigh * (h3 - h4)
      const h = s - h4
      sh += h * h
    }
    full[f] = Math.sqrt(sf / hop)
    low[f] = Math.sqrt(sl / hop)
    mid[f] = Math.sqrt(sm / hop)
    high[f] = Math.sqrt(sh / hop)
  }
  return { fps, frames, full, low, mid, high }
}

/** How sharply loudness rises at each frame, scaled so the loudest ~1.5% sit at 1. */
function onsetStrength(env: Float32Array): Float32Array {
  const n = env.length
  const o = new Float32Array(n)
  for (let f = 1; f < n; f++) {
    o[f] = Math.max(0, Math.log(1 + env[f] * 60) - Math.log(1 + env[f - 1] * 60))
  }
  const sample: number[] = []
  for (let f = 0; f < n; f += 5) sample.push(o[f])
  sample.sort((a, b) => a - b)
  const ref = sample[Math.floor(sample.length * 0.985)] || 1e-4
  for (let f = 0; f < n; f++) o[f] = Math.min(1, Math.pow(o[f] / ref, 0.8))
  return o
}

/**
 * Finds the beat length (in frames, fractional) and the frame of the first beat.
 * Autocorrelation picks the tempo; a comb then slides over the onsets to lock the phase,
 * and a fine search around the winning lag corrects for whole-frame rounding.
 */
function findBeatGrid(beatEnv: Float32Array, fps: number): { lag: number; offset: number } {
  const frames = beatEnv.length
  let mean = 0
  for (let f = 0; f < frames; f++) mean += beatEnv[f]
  mean /= Math.max(1, frames)
  const centred = new Float32Array(frames)
  for (let f = 0; f < frames; f++) centred[f] = beatEnv[f] - mean

  const loLag = Math.floor((60 / MAX_BPM) * fps)
  const hiLag = Math.ceil((60 / MIN_BPM) * fps)
  const ac = new Float32Array(2 * hiLag + 2)
  for (let lag = Math.max(0, loLag - 1); lag < ac.length; lag++) {
    const n = frames - lag
    if (n <= 0) break
    let s = 0
    for (let k = 0; k < n; k++) s += centred[k] * centred[k + lag]
    ac[lag] = s / n
  }
  // A beat rarely lasts a whole number of frames; when it falls between two, its peak is split
  // across both. Taking the best neighbour stops a half-length lag winning on rounding alone.
  const peakNear = (lag: number) => Math.max(ac[lag - 1], ac[lag], ac[lag + 1])

  let bestLag = loLag
  let best = -1e9
  for (let lag = loLag; lag <= hiLag; lag++) {
    const bpm = (60 * fps) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log(bpm / PRIOR_BPM) / Math.LN2 / 0.65, 2))
    const score = (peakNear(lag) + 0.5 * peakNear(2 * lag)) * prior
    if (score > best) {
      best = score
      bestLag = lag
    }
  }

  let lag = bestLag
  let { offset, score } = bestPhase(beatEnv, bestLag)
  for (let dl = -1.2; dl <= 1.2; dl += 0.15) {
    if (bestLag + dl < loLag - 2) continue
    const r = bestPhase(beatEnv, bestLag + dl)
    if (r.score > score) {
      score = r.score
      lag = bestLag + dl
      offset = r.offset
    }
  }
  return { lag, offset }
}

/**
 * Autocorrelation can't tell a beat from two beats: a pop groove (boom 1-3, clap 2-4) at 130
 * looks exactly like a slow groove (boom 1, clap 2) at 65. The difference is where the real
 * drums sit — if booms and claps keep landing halfway between the counts, the counts are
 * too slow. Hi-hats are left out, since they sit on the half counts in nearly every song.
 */
function correctOctave(
  grid: { lag: number; offset: number },
  beatEnv: Float32Array,
  drums: Float32Array,
  fps: number,
): { lag: number; offset: number } {
  const bpm = (60 * fps) / grid.lag
  if (bpm * 2 > MAX_COUNTED_BPM) return grid
  const between = combScore(drums, grid.lag, grid.offset + grid.lag / 2)
  const on = combScore(drums, grid.lag, grid.offset)
  if (between < on * 0.7 && bpm >= MIN_COUNTED_BPM) return grid
  const lag = grid.lag / 2
  return { lag, offset: bestPhase(beatEnv, lag).offset }
}

/** Tempos a triplet feel can be mistaken for, as multiples of the beat length. */
const TRIPLET_RATIOS = [2 / 3, 3 / 4, 4 / 3, 3 / 2]
/** An alternative tempo has to beat the first reading by this much to replace it. */
const TRIPLET_MARGIN = 1.15

/**
 * Hip hop hi-hats often run in threes, and a few seconds of them can make a tempo 3:2 or
 * 4:3 away from the real one look best (75 or 150 instead of 112). Booms and claps settle
 * it: on the real tempo they land on the counts, on the wrong one most fall between them.
 * Halving and doubling aren't tried here — booms land on every count of a half-speed grid
 * too, so this test can't see those; correctOctave handles them.
 */
function correctTriplet(
  grid: { lag: number; offset: number },
  beatEnv: Float32Array,
  drums: Float32Array,
  shapes: Float32Array[],
  fps: number,
): { lag: number; offset: number; checked: boolean } {
  const minLag = (60 / MAX_BPM) * fps
  const maxLag = (60 / MIN_BPM) * fps
  const fits = (l: number) => l >= minLag && l <= maxLag

  // Best test: a song repeats itself every 8 counts. Through a phone or laptop speaker the
  // booms are mostly gone and the comb test below can't tell 75 from 112, but the 8 still
  // repeats clearly on the right tempo and not on the wrong one. It's also sharper than
  // autocorrelation, which sometimes reads 121 for a 112 song, so each candidate is searched
  // a little either side.
  const first = bestRepeat(shapes, grid.lag)
  if (first) {
    // a half-speed first reading is only replaced when the 8 at twice the speed repeats
    // clearly better; otherwise halving and doubling are left to correctOctave
    const double = fits(grid.lag / 2) ? bestRepeat(shapes, grid.lag / 2) : null
    const base = double && double.score > first.score + REPEAT_MARGIN ? double : first
    // a drum loop repeats every 4 counts, so 6 and 12 counts repeat as well as 8 do: a
    // triplet reading has to repeat clearly better, not just as well
    let pick = base
    for (const r of TRIPLET_RATIOS) {
      if (!fits(base.lag * r)) continue
      const alt = bestRepeat(shapes, base.lag * r)
      if (alt && alt.score > base.score + REPEAT_MARGIN && alt.score > pick.score) pick = alt
    }
    return { lag: pick.lag, offset: bestPhase(beatEnv, pick.lag).offset, checked: true }
  }

  let best = grid.lag
  let bestScore = bestPhase(drums, grid.lag).score * TRIPLET_MARGIN
  for (const r of TRIPLET_RATIOS) {
    const lag = grid.lag * r
    if (!fits(lag) || lag * 8 > drums.length) continue
    const score = bestPhase(drums, lag).score
    if (score > bestScore) {
      bestScore = score
      best = lag
    }
  }
  return best === grid.lag
    ? { ...grid, checked: false }
    : { lag: best, offset: bestPhase(beatEnv, best).offset, checked: false }
}

/** Counts in one 8, the stretch of music a song repeats. */
const CYCLE = 8
/** Onsets are smoothed over this many frames each side before comparing whole 8s. */
const SHAPE_FRAMES = 6
/** Another tempo's 8 has to repeat this much better (in correlation) to replace the first reading. */
const REPEAT_MARGIN = 0.08

function smooth(env: Float32Array, k: number): Float32Array {
  const out = new Float32Array(env.length)
  let s = 0
  for (let i = 0; i < Math.min(k, env.length); i++) s += env[i]
  for (let i = 0; i < env.length; i++) {
    if (i + k < env.length) s += env[i + k]
    if (i - k - 1 >= 0) s -= env[i - k - 1]
    out[i] = s
  }
  return out
}

/** How far either side of a reading to look for the tempo whose 8 repeats best. */
const REPEAT_SEARCH = 0.08
const REPEAT_STEP = 0.005

function bestRepeat(shapes: Float32Array[], lag: number): { lag: number; score: number } | null {
  let best: { lag: number; score: number } | null = null
  for (let d = -REPEAT_SEARCH; d <= REPEAT_SEARCH + 1e-9; d += REPEAT_STEP) {
    const l = lag * (1 + d)
    const score = repeatScore(shapes, l * CYCLE)
    if (score !== null && (!best || score > best.score)) best = { lag: l, score }
  }
  return best
}

/**
 * How alike the music is to itself `lag` frames later, -1 to 1, averaged over the bands.
 * Null when the window is too short to compare more than a little of it.
 */
function repeatScore(shapes: Float32Array[], lag: number): number | null {
  if (shapes[0].length < lag * 1.6) return null
  let total = 0
  for (const e of shapes) {
    let best = -1
    for (const d of [-1, 0, 1]) {
      const L = Math.round(lag) + d
      const n = e.length - L
      let ma = 0
      let mb = 0
      for (let i = 0; i < n; i++) {
        ma += e[i]
        mb += e[i + L]
      }
      ma /= n
      mb /= n
      let sab = 0
      let saa = 0
      let sbb = 0
      for (let i = 0; i < n; i++) {
        const a = e[i] - ma
        const b = e[i + L] - mb
        sab += a * b
        saa += a * a
        sbb += b * b
      }
      best = Math.max(best, sab / Math.sqrt(saa * sbb + 1e-12))
    }
    total += best
  }
  return total / shapes.length
}

/**
 * Through a small speaker the low end is mostly room boom and bass notes, which can pull the
 * beats half a count off. Claps and hi-hats are clicks that every speaker plays, so when those
 * two agree with each other and not with the first guess, they win.
 */
function checkPhase(lag: number, offset: number, mid: Float32Array, high: Float32Array): number {
  const near = (a: number, b: number) => {
    const d = (((a - b) % lag) + lag) % lag
    return Math.min(d, lag - d) < lag * 0.12
  }
  const m = bestPhase(mid, lag).offset
  const h = bestPhase(high, lag).offset
  if (!near(m, h) || near(m, offset)) return offset
  const upper = new Float32Array(mid.length)
  for (let f = 0; f < mid.length; f++) upper[f] = 0.65 * mid[f] + 0.35 * high[f]
  return bestPhase(upper, lag).offset
}

/** Average onset strength on a comb of beats, allowing each to land a frame early or late. */
function combScore(env: Float32Array, lag: number, offset: number): number {
  let s = 0
  let n = 0
  for (let p = offset; p < env.length - 2; p += lag) {
    const f = Math.round(p)
    if (f < 0) continue
    s += Math.max(f > 0 ? env[f - 1] : 0, env[f], env[f + 1])
    n++
  }
  return n ? s / n : 0
}

function bestPhase(env: Float32Array, lag: number): { offset: number; score: number } {
  let offset = 0
  let score = -1
  for (let off = 0; off < lag; off++) {
    const s = combScore(env, lag, off)
    if (s > score) {
      score = s
      offset = off
    }
  }
  for (let d = -0.8; d <= 0.8; d += 0.2) {
    if (offset + d < 0) continue
    const s = combScore(env, lag, offset + d)
    if (s > score) {
      score = s
      offset = offset + d
    }
  }
  return { offset, score }
}

/**
 * Which of the first four beats is the "1": the one where the bass swells most.
 * This measures raw low-band energy rather than onset strength — onsets are clipped at 1,
 * and a snare's low end clips just as easily as a kick's, which turned the choice into a tie.
 */
function findDownbeat(low: Float32Array, fps: number, lag: number, offset: number) {
  const span = Math.max(3, Math.round(fps * 0.08))
  const swell = (f: number) => {
    let peak = 0
    for (let j = f; j < Math.min(low.length, f + span); j++) if (low[j] > peak) peak = low[j]
    return Math.max(0, peak - low[Math.max(0, f - 2)])
  }
  let best = 0
  let bestScore = -1
  let second = 0
  for (let m = 0; m < 4; m++) {
    let s = 0
    let n = 0
    for (let p = offset + m * lag; p < low.length - 2; p += lag * 4) {
      s += swell(Math.round(p))
      n++
    }
    const score = n ? s / n : 0
    if (score > bestScore) {
      second = Math.max(second, bestScore)
      bestScore = score
      best = m
    } else if (score > second) {
      second = score
    }
  }
  return { downbeat: best, margin: second > 0 ? bestScore / second : bestScore > 0 ? Infinity : 1 }
}

/**
 * Every hit gets found once, then sorted into exactly ONE lane by the shape of its
 * sound rather than by pitch alone — a drum hit is a click, and a click contains every
 * frequency, so filtering can never separate them on its own.
 */
function findHits(
  bands: Bands,
  onsets: { low: Float32Array; mid: Float32Array; high: Float32Array; full: Float32Array },
): [Hit[], Hit[], Hit[]] {
  const { fps, frames } = bands
  const localWin = Math.max(4, Math.round(fps * 0.12))

  const peaksInto = (arr: Float32Array, threshold: number, out: number[]) => {
    for (let i = 2; i < frames - 2; i++) {
      const v = arr[i]
      if (v < threshold) continue
      if (v < arr[i - 1] || v < arr[i + 1] || v < arr[i - 2] || v < arr[i + 2]) continue
      let sum = 0
      let cnt = 0
      for (let j = Math.max(0, i - localWin), hi = Math.min(frames, i + localWin); j < hi; j++) {
        sum += arr[j]
        cnt++
      }
      if (v < (sum / cnt) * 1.8 + 0.05) continue
      out.push(i)
    }
  }
  const raw: number[] = []
  peaksInto(onsets.full, 0.13, raw)
  peaksInto(onsets.low, 0.17, raw)
  peaksInto(onsets.mid, 0.17, raw)
  peaksInto(onsets.high, 0.13, raw)
  raw.sort((a, b) => a - b)

  // the same hit shows up in several bands a frame or two apart; keep one
  const merged: number[] = []
  const gap = Math.max(2, Math.round(fps * 0.045))
  for (const fr of raw) {
    const last = merged.length - 1
    if (merged.length && fr - merged[last] <= gap) {
      if (onsets.full[fr] > onsets.full[merged[last]]) merged[last] = fr
      continue
    }
    merged.push(fr)
  }

  // a boom's low end swells over ~80ms; a tick is over in 15ms. Measure each where it lives.
  const riseOf = (env: Float32Array, fr: number, span: number) => {
    const pre = env[Math.max(0, fr - 2)]
    let post = 0
    for (let j = fr; j < Math.min(frames, fr + span); j++) if (env[j] > post) post = env[j]
    return Math.max(0, post - pre)
  }
  const wLow = Math.max(3, Math.round(fps * 0.08))
  const wMid = Math.max(2, Math.round(fps * 0.04))
  const wHigh = Math.max(2, Math.round(fps * 0.015))
  const eL = merged.map((fr) => riseOf(bands.low, fr, wLow))
  const eM = merged.map((fr) => riseOf(bands.mid, fr, wMid))
  const eH = merged.map((fr) => riseOf(bands.high, fr, wHigh))

  // Reference each band against its LOUDEST events, not its typical ones. At the 90th
  // percentile the handful of real booms sat above the mark, which made a snare look
  // almost as bass-heavy as a kick.
  const refL = loudRef(eL)
  const refM = loudRef(eM)
  const refH = loudRef(eH)

  // Pass one: find the booms. A boom is loud down low AND genuinely bass-weighted.
  const live: boolean[] = []
  const boom: boolean[] = []
  for (let k = 0; k < merged.length; k++) {
    const total = eL[k] + eM[k] + eH[k]
    if (total <= 1e-7) {
      live.push(false)
      boom.push(false)
      continue
    }
    const nL = eL[k] / refL
    const nM = eM[k] / refM
    const nH = eH[k] / refH
    // a ringing tail is a faint echo of a real hit; ignore anything this weak
    const awake = Math.max(nL, nM, nH) >= 0.35
    live.push(awake)
    boom.push(awake && nL >= 0.5 && eL[k] / total >= 0.18 && nL >= nM * 0.8)
  }

  // A kick's click carries plenty of middle as well, so "how loud does the middle get"
  // has to be measured over the hits that are NOT booms — otherwise the loudest middle
  // in the track belongs to the kick and a clap never clears the bar.
  const restM: number[] = []
  const restH: number[] = []
  for (let k = 0; k < merged.length; k++) {
    if (live[k] && !boom[k]) {
      restM.push(eM[k])
      restH.push(eH[k])
    }
  }
  const refM2 = loudRef(restM)
  const refH2 = loudRef(restH)

  // Pass two: everything that is not a boom is a clap if it has real middle, else a tick.
  const lanes: [Hit[], Hit[], Hit[]] = [[], [], []]
  for (let k = 0; k < merged.length; k++) {
    if (!live[k]) continue
    const fr = merged[k]
    const lane = boom[k] ? 0 : eM[k] / refM2 >= 0.45 ? 1 : 2
    lanes[lane].push({ t: fr / fps, v: Math.max(0.2, Math.min(1, onsets.full[fr])), f: fr })
    // the tick row keeps the pulse, so show it even when a louder sound lands on top
    const nH = eH[k] / refH2
    if (lane !== 2 && nH > 0.5) lanes[2].push({ t: fr / fps, v: Math.min(1, nH * 0.8), f: fr })
  }
  lanes[2].sort((a, b) => a.t - b.t)

  for (let ln = 0; ln < 3; ln++) {
    lanes[ln] = dropNearDuplicates(lanes[ln], 0.07)
    // each row gets its own loudness scale, so quiet ticks stay visible next to loud booms
    const vs = lanes[ln].map((h) => h.v).sort((a, b) => a - b)
    if (!vs.length) continue
    const ref = vs[Math.floor(vs.length * 0.85)] || 1
    for (const h of lanes[ln]) h.v = Math.max(0.3, Math.min(1, h.v / ref))
  }
  return lanes
}

function loudRef(arr: number[]): number {
  if (!arr.length) return 1e-6
  const sorted = arr.slice().sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length * 0.97)] || sorted[sorted.length - 1] || 1e-6
}

/** Within `minSep` seconds keep only the louder hit. */
function dropNearDuplicates(hits: Hit[], minSep: number): Hit[] {
  const keep: Hit[] = []
  for (const h of hits) {
    const prev = keep[keep.length - 1]
    if (prev && h.t - prev.t < minSep) {
      if (h.v > prev.v) keep[keep.length - 1] = h
      continue
    }
    keep.push(h)
  }
  return keep
}

/** Which counts (1–8) a lane's hits mostly fall on, or null if there's no clear pattern. */
function landsOn(hits: Hit[], anchorFrame: number, lag: number): number[] | null {
  if (hits.length < 3) return null
  const counts = new Float32Array(8)
  let used = 0
  for (const h of hits) {
    const k = (h.f - anchorFrame) / lag
    const nearest = Math.round(k)
    if (nearest < 0 || Math.abs(k - nearest) > 0.18) continue
    counts[((nearest % 8) + 8) % 8]++
    used++
  }
  if (used < 3) return null
  const max = Math.max(...counts)
  const out: number[] = []
  for (let c = 0; c < 8; c++) if (counts[c] >= max * 0.5) out.push(c + 1)
  return out.length && out.length <= 4 ? out : null
}

function listOf(nums: number[]): string {
  return nums.length > 1 ? nums.slice(0, -1).join(', ') + ' and ' + nums[nums.length - 1] : String(nums[0])
}

/** Peak loudness squeezed into a fixed number of points, normalised to 0–1. */
function overview(full: Float32Array, frames: number): Float32Array {
  const pts = Math.min(ENVELOPE_POINTS, frames)
  const env = new Float32Array(pts)
  let peak = 0
  for (let e = 0; e < pts; e++) {
    const i0 = Math.floor((e / pts) * frames)
    const i1 = Math.max(i0 + 1, Math.floor(((e + 1) / pts) * frames))
    let m = 0
    for (let i = i0; i < i1 && i < frames; i++) if (full[i] > m) m = full[i]
    env[e] = m
    if (m > peak) peak = m
  }
  if (peak > 0) for (let e = 0; e < pts; e++) env[e] /= peak
  return env
}
