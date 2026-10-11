import type { Analysis } from '../analysis/types'
import {
  TAP_RESET_SECONDS,
  TAPS_NEEDED,
  beatLength,
  clampBpm,
  clampOffset,
  countOf,
  effectiveAnchor,
  isFocused,
  nearestOne,
  tempoFromTaps,
  type Focus,
  type Grid,
} from './grid'
import { playTick, speakCount, stopSpeaking, unlockSpeech, type TickKind } from './sounds'

/** 'file': we play the song ourselves. 'tap': the song plays elsewhere and we only keep time. */
export type Mode = 'tap' | 'file'

export interface Options {
  click: boolean
  voice: boolean
  countIn: boolean
  focus: Focus
  /** Playback speed for a file, 0.5–1. */
  rate: number
}

export interface EngineState {
  mode: Mode
  grid: Grid
  running: boolean
  options: Options
  /** Taps collected so far towards a new tempo. */
  taps: number
  duration: number
  analysis: Analysis | null
}

const LOOKAHEAD = 0.16
const PUMP_MS = 25
/** The voice can't keep up with fast songs; below this beat length it stays quiet. */
const MIN_SPOKEN_BEAT = 0.3

/**
 * Keeps the count. Owns the AudioContext, plays the song, and schedules ticks slightly ahead
 * of the audio clock so they land exactly on the beat no matter how busy the main thread is.
 *
 * React reads the slow-changing state through subscribe/getState (useSyncExternalStore);
 * per-frame things like the current count read `position()` directly in an animation loop.
 */
export class CountEngine {
  private state: EngineState = {
    mode: 'tap',
    grid: { bpm: 93, anchor: 0, offsetMs: 0 },
    running: false,
    options: { click: true, voice: false, countIn: false, focus: 'all', rate: 1 },
    taps: 0,
    duration: 0,
    analysis: null,
  }
  private listeners = new Set<() => void>()

  private ctx: AudioContext | null = null
  private music: GainNode | null = null
  private ticks: GainNode | null = null

  private buffer: AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  /** Audio-clock time at which song position `startPos` plays. */
  private startCtx = 0
  private startPos = 0
  private pausePos = 0

  private tapTimes: number[] = []
  private nextBeat: number | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  // ---------- store ----------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getState = () => this.state

  private set(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  // ---------- clock ----------

  /** Creates the AudioContext on first use; browsers only allow that inside a user gesture. */
  audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.music = this.ctx.createGain()
      this.music.gain.value = 0.9
      this.music.connect(this.ctx.destination)
      this.ticks = this.ctx.createGain()
      this.ticks.gain.value = 0.5
      this.ticks.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }

  /** Where we are in the song, in seconds. In tap mode the song is the audio clock itself. */
  position(): number {
    const { mode, running, options, grid } = this.state
    if (!this.ctx) return mode === 'file' ? this.pausePos : effectiveAnchor(grid)
    if (mode === 'file') return running ? this.startPos + (this.ctx.currentTime - this.startCtx) * options.rate : this.pausePos
    return running ? this.ctx.currentTime : effectiveAnchor(grid)
  }

  private clockAt(songTime: number): number {
    return this.state.mode === 'file' ? this.startCtx + (songTime - this.startPos) / this.state.options.rate : songTime
  }

  // ---------- loading ----------

  loadFile(buffer: AudioBuffer, analysis: Analysis, saved?: Partial<Grid>) {
    this.stop()
    this.buffer = buffer
    this.pausePos = 0
    this.tapTimes = []
    this.set({
      mode: 'file',
      duration: buffer.duration,
      analysis,
      taps: 0,
      grid: {
        bpm: clampBpm(saved?.bpm ?? analysis.bpm),
        anchor: saved?.anchor ?? analysis.anchor,
        offsetMs: clampOffset(saved?.offsetMs ?? 0),
      },
    })
  }

  useTapMode(saved?: Partial<Grid>) {
    this.stop()
    this.buffer = null
    this.tapTimes = []
    this.set({
      mode: 'tap',
      duration: 0,
      analysis: null,
      taps: 0,
      grid: { bpm: clampBpm(saved?.bpm ?? this.state.grid.bpm), anchor: 0, offsetMs: clampOffset(saved?.offsetMs ?? 0) },
      options: { ...this.state.options, rate: 1 },
    })
  }

  // ---------- transport ----------

  toggle() {
    this.audio()
    if (this.state.running) this.stop()
    else this.start()
  }

  start() {
    const ctx = this.audio()
    const { mode, grid, options } = this.state
    if (mode === 'tap') {
      // the music kept playing while we were stopped, so the grid carries on from the same
      // anchor rather than restarting wherever the button was pressed
      if (!this.tapTimes.length && !grid.anchor) this.setGrid({ anchor: ctx.currentTime - grid.offsetMs / 1000 })
      this.setRunning(true)
      return
    }
    if (!this.buffer) return
    const end = Math.max(0, this.state.duration - 0.05)
    let from = Math.min(Math.max(this.pausePos, 0), end)
    let leadIn = 0
    if (options.countIn) {
      from = nearestOne(grid, from, this.state.duration)
      leadIn = (4 * beatLength(grid)) / options.rate
    }
    const src = ctx.createBufferSource()
    src.buffer = this.buffer
    src.playbackRate.value = options.rate
    src.connect(this.music!)
    const when = ctx.currentTime + 0.09 + leadIn
    this.startCtx = when
    this.startPos = from
    src.onended = () => {
      if (this.source !== src) return
      this.source = null
      this.pausePos = 0
      this.setRunning(false)
    }
    this.source = src
    src.start(when, from)
    this.setRunning(true)
  }

  stop() {
    if (this.state.mode === 'file') {
      this.pausePos = Math.min(Math.max(this.position(), 0), this.state.duration)
      const src = this.source
      this.source = null
      try {
        src?.stop()
      } catch {
        // already stopped
      }
    }
    if (this.state.running) this.setRunning(false)
  }

  seek(songTime: number) {
    if (this.state.mode !== 'file') return
    const wasRunning = this.state.running
    if (wasRunning) this.stop()
    this.pausePos = Math.min(Math.max(songTime, 0), this.state.duration)
    if (wasRunning) this.start()
  }

  private setRunning(on: boolean) {
    if (on && !this.timer) this.timer = setInterval(this.pump, PUMP_MS)
    if (!on) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      stopSpeaking()
    }
    this.nextBeat = null
    this.set({ running: on })
  }

  // ---------- the ticks ----------

  /** Schedules every tick due in the next LOOKAHEAD seconds. Runs every PUMP_MS. */
  private pump = () => {
    const ctx = this.ctx
    if (!this.state.running || !ctx) return
    const { grid } = this.state
    const beat = beatLength(grid)
    const anchor = effectiveAnchor(grid)
    if (this.nextBeat === null) this.nextBeat = Math.ceil((this.position() - anchor) / beat - 1e-4)
    for (let guard = 0; guard < 64; guard++) {
      const t = this.clockAt(anchor + this.nextBeat * beat)
      if (t > ctx.currentTime + LOOKAHEAD) break
      if (t >= ctx.currentTime - 0.02) this.sound(this.nextBeat, t)
      this.nextBeat++
    }
  }

  private sound(beat: number, t: number) {
    const { options, grid } = this.state
    const count = countOf(beat)
    const focused = isFocused(options.focus, count)
    const kind: TickKind = !focused ? 'ghost' : count === 0 ? 'one' : count === 4 ? 'five' : 'num'
    if (options.click) playTick(this.ctx!, this.ticks!, t, kind)
    if (options.voice && focused && beatLength(grid) / options.rate >= MIN_SPOKEN_BEAT) {
      speakCount(count, (t - this.ctx!.currentTime) * 1000)
    }
  }

  // ---------- tapping ----------

  /** Records one tap. Returns true once enough taps are in and the tempo has been set. */
  tap(): boolean {
    const ctx = this.audio()
    playTick(ctx, this.ticks!, ctx.currentTime + 0.01, 'tap')
    const t = this.state.mode === 'file' ? this.position() : ctx.currentTime
    const last = this.tapTimes[this.tapTimes.length - 1]
    if (last !== undefined && t - last > TAP_RESET_SECONDS) this.tapTimes = []
    this.tapTimes.push(t)
    if (this.tapTimes.length < TAPS_NEEDED) {
      this.set({ taps: this.tapTimes.length })
      return false
    }
    const bpm = tempoFromTaps(this.tapTimes)
    if (bpm === null) {
      this.resetTaps()
      return false
    }
    const anchor = this.tapTimes[0] - this.state.grid.offsetMs / 1000
    this.tapTimes = []
    this.set({ taps: 0 })
    this.setGrid({ bpm: clampBpm(bpm), anchor })
    if (!this.state.running && this.state.mode === 'tap') this.setRunning(true)
    return true
  }

  resetTaps() {
    this.tapTimes = []
    this.set({ taps: 0 })
  }

  /** "It's off — tap on the 1": the moment this is called becomes a 1. */
  markOne() {
    const ctx = this.audio()
    if (this.state.mode === 'tap' && !this.state.running) {
      this.setGrid({ anchor: ctx.currentTime })
      this.setRunning(true)
    } else {
      this.setGrid({ anchor: this.position() - this.state.grid.offsetMs / 1000 })
    }
  }

  // ---------- knobs ----------

  setBpm(bpm: number) {
    this.setGrid({ bpm: clampBpm(bpm) })
  }

  setOffset(ms: number) {
    this.setGrid({ offsetMs: clampOffset(ms) })
  }

  private setGrid(patch: Partial<Grid>) {
    this.nextBeat = null
    this.set({ grid: { ...this.state.grid, ...patch } })
  }

  setOption<K extends keyof Options>(key: K, value: Options[K]) {
    if (key === 'rate') this.setRate(value as number)
    else if (key === 'voice' && value) unlockSpeech()
    this.set({ options: { ...this.state.options, [key]: value } })
    this.nextBeat = null
  }

  private setRate(rate: number) {
    if (this.state.running && this.source && this.ctx) {
      // re-base the clock so the song position stays continuous across the speed change
      this.startPos = this.position()
      this.startCtx = this.ctx.currentTime
      this.source.playbackRate.value = rate
    }
  }

  dispose() {
    this.stop()
    void this.ctx?.close()
    this.ctx = null
  }
}

