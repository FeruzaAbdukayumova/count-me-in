import type { CountEngine } from '../engine/CountEngine'
import { clapCounts } from '../learn/clap'
import { QUIET_RMS, rms } from './estimate'
import { BeatFollower } from './follow'
import type { ListenRequest, ListenResponse } from './listen.worker'

/**
 * - asking: waiting for the browser's microphone permission
 * - denied / unsupported: no microphone to listen with
 * - quiet: the microphone is on but hears no music
 * - listening: hearing music, still working out the beat
 * - locked: counting along
 */
export type ListenStatus = 'off' | 'asking' | 'denied' | 'unsupported' | 'quiet' | 'listening' | 'locked'

export interface ListenState {
  status: ListenStatus
  /** Seconds of music heard since listening started, for the "almost there" progress. */
  heard: number
  /** The counts (0–7) this song's claps land on, once the count is locked and they're clear. */
  claps: number[] | null
  /** Whether the microphone can hear music right now. The count carries on either way. */
  hearing: boolean
  /** The music has stopped matching the count for a while: probably a different song. */
  doubt: boolean
}

/**
 * Longest window analysed, in seconds. The window grows from the first sound up to this.
 * Fast hi-hat rolls can make 10 seconds of a song read 3:2 off its real tempo; by about
 * 18 seconds the reading settles.
 */
const WINDOW = 20
/** The first estimate needs at least this much. */
const FIRST_WINDOW = 5
/** A new estimate this often. */
const STEP_MS = 2000
/** How long the room has to be quiet before we say we can't hear anything. */
const QUIET_SECONDS = 2.5
/** Assumed delay between sound reaching the mic and the samples reaching us, when the browser doesn't say. */
const DEFAULT_INPUT_LATENCY = 0.02

/** Runs inside the audio thread: hands over the microphone samples in blocks, stamped with audio-clock time. */
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; this.start = 0 }
  process(inputs) {
    const input = inputs[0]
    if (!input || !input[0]) return true
    const len = input[0].length
    if (this.n === 0) this.start = currentFrame
    for (let i = 0; i < len; i++) {
      let v = 0
      for (let c = 0; c < input.length; c++) v += input[c][i]
      this.buf[this.n++] = v / input.length
    }
    if (this.n + len > this.buf.length) {
      const out = this.buf.slice(0, this.n)
      this.port.postMessage({ frame: this.start, samples: out }, [out.buffer])
      this.n = 0
    }
    return true
  }
}
registerProcessor('count-me-in-capture', Capture)
`

interface Chunk {
  /** Audio-clock time of the chunk's first sample. */
  time: number
  samples: Float32Array
}

/** Listens to the room through the microphone and keeps the engine's count in time with it. */
export class Listener {
  private state: ListenState = { status: 'off', heard: 0, claps: null, hearing: false, doubt: false }
  private listeners = new Set<() => void>()

  private follower = new BeatFollower()
  private stream: MediaStream | null = null
  private nodes: AudioNode[] = []
  private worker: Worker | null = null
  private busy = false
  private timer: ReturnType<typeof setInterval> | null = null
  private chunks: Chunk[] = []
  private latency = DEFAULT_INPUT_LATENCY
  private sampleRate = 48000
  private quietSince: number | null = null
  private heardFrom: number | null = null
  /** Bumped on every start/stop, so a late permission answer can't revive a stopped listener. */
  private session = 0

  private engine: CountEngine

  constructor(engine: CountEngine) {
    this.engine = engine
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getState = () => this.state

  private set(patch: Partial<ListenState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /** Must be called from a tap or click: that's when browsers allow the microphone and sound to start. */
  async start() {
    this.stop()
    const session = ++this.session
    const ctx = this.engine.audio()
    this.engine.useListenMode()
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      this.set({ status: 'unsupported' })
      return
    }
    this.set({ status: 'asking', heard: 0, claps: null, hearing: false, doubt: false })
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // all three would fight us: echo cancellation removes music the phone itself is
        // playing, and the other two flatten the drum hits we're looking for
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch {
      if (session === this.session) this.set({ status: 'denied' })
      return
    }
    if (session !== this.session) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    this.stream = stream
    const settings = stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }
    this.latency = typeof settings?.latency === 'number' && settings.latency > 0 ? settings.latency : DEFAULT_INPUT_LATENCY
    this.sampleRate = ctx.sampleRate

    const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'application/javascript' }))
    try {
      await ctx.audioWorklet.addModule(url)
    } catch {
      // already added by an earlier session on this AudioContext
    } finally {
      URL.revokeObjectURL(url)
    }
    if (session !== this.session) return
    const source = ctx.createMediaStreamSource(stream)
    const capture = new AudioWorkletNode(ctx, 'count-me-in-capture')
    // the worklet only runs while connected to the output; a muted gain keeps the mic out of the speakers
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(capture).connect(mute).connect(ctx.destination)
    this.nodes = [source, capture, mute]
    capture.port.onmessage = (e: MessageEvent<{ frame: number; samples: Float32Array }>) =>
      this.onChunk({ time: e.data.frame / this.sampleRate, samples: e.data.samples })

    this.worker = new Worker(new URL('./listen.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<ListenResponse>) => {
      this.busy = false
      this.onEstimate(e.data)
    }
    this.worker.onerror = () => {
      this.busy = false
    }
    this.timer = setInterval(this.analyse, STEP_MS)
    this.set({ status: 'quiet' })
  }

  stop() {
    this.session++
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.worker?.terminate()
    this.worker = null
    this.busy = false
    this.nodes.forEach((n) => n.disconnect())
    this.nodes = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.chunks = []
    this.follower.reset()
    this.quietSince = null
    this.heardFrom = null
    if (this.state.status !== 'off') this.set({ status: 'off', heard: 0, claps: null, hearing: false, doubt: false })
  }

  /** The dancer placed the 1 by hand; the microphone keeps the tempo but leaves the 1 alone. */
  placeOne(anchor: number) {
    this.follower.override(anchor)
  }

  /** A new song: forget the beat and find it again, with the microphone still open. */
  findAgain() {
    if (this.state.status === 'off' || this.state.status === 'asking') return
    this.follower.reset()
    this.chunks = []
    this.heardFrom = null
    this.quietSince = null
    this.set({ status: 'quiet', heard: 0, claps: null, hearing: false, doubt: false })
  }

  private onChunk(chunk: Chunk) {
    this.chunks.push(chunk)
    const keepFrom = chunk.time - WINDOW - 1
    while (this.chunks.length && this.chunks[0].time < keepFrom) this.chunks.shift()

    const loud = rms(chunk.samples) >= QUIET_RMS
    const now = chunk.time
    if (loud) {
      this.quietSince = null
      this.heardFrom ??= now
      if (!this.state.hearing) this.set({ hearing: true })
    } else {
      this.quietSince ??= now
      if (now - this.quietSince > QUIET_SECONDS) {
        this.heardFrom = null
        if (this.state.status === 'listening') this.set({ status: 'quiet', heard: 0 })
        if (this.state.hearing) this.set({ hearing: false })
        return
      }
    }
    if (this.heardFrom !== null && this.state.status === 'quiet') this.set({ status: 'listening' })
    if (this.state.status === 'listening' && this.heardFrom !== null) {
      const heard = Math.round(now - this.heardFrom)
      if (heard !== this.state.heard) this.set({ heard })
    }
  }

  private analyse = () => {
    if (import.meta.env.DEV) {
      const last = this.chunks[this.chunks.length - 1]
      console.debug(
        '[mic]',
        JSON.stringify({
          t: +this.engine.audio().currentTime.toFixed(2),
          chunks: this.chunks.length,
          rms: last ? +rms(last.samples).toFixed(4) : null,
          heardFrom: this.heardFrom && +this.heardFrom.toFixed(2),
          status: this.state.status,
        }),
      )
    }
    if (this.busy || !this.worker || !this.chunks.length) return
    const last = this.chunks[this.chunks.length - 1]
    const end = last.time + last.samples.length / this.sampleRate
    const from = Math.max(end - WINDOW, this.heardFrom ?? end)
    if (end - from < FIRST_WINDOW) return
    const parts = this.chunks.filter((c) => c.time + c.samples.length / this.sampleRate > from)
    const total = parts.reduce((n, c) => n + c.samples.length, 0)
    const samples = new Float32Array(total)
    let at = 0
    for (const c of parts) {
      samples.set(c.samples, at)
      at += c.samples.length
    }
    const msg: ListenRequest = { samples, sampleRate: this.sampleRate, startTime: parts[0].time - this.latency }
    this.busy = true
    this.worker.postMessage(msg, [samples.buffer])
  }

  private onEstimate(est: ListenResponse) {
    if (!est) return
    const before = this.engine.getState().grid
    const wasLocked = this.follower.status === 'locked'
    const lock = this.follower.feed(est)
    if (lock) this.engine.follow(lock.bpm, lock.anchor)
    if (import.meta.env.DEV) {
      const beat = 60 / before.bpm
      const k = lock && wasLocked ? (lock.anchor - before.anchor) / beat : 0
      const jump = Math.round(k)
      console.debug(
        '[listen]',
        JSON.stringify({
          t: +this.engine.audio().currentTime.toFixed(2),
          est: +est.bpm.toFixed(1),
          sure: est.sure,
          status: this.follower.status,
          bpm: lock ? +lock.bpm.toFixed(2) : null,
          // how far this update moved the count: whole counts, and milliseconds
          jumpCounts: ((jump % 8) + 8) % 8,
          jumpMs: Math.round((k - jump) * beat * 1000),
          claps: est.claps && clapCounts(est.claps, this.engine.getState().grid)?.map((c) => c + 1),
          doubt: this.follower.doubt,
        }),
      )
    }
    if (this.follower.status === 'locked' && est.claps) {
      const claps = clapCounts(est.claps, this.engine.getState().grid)
      if (claps && claps.join() !== this.state.claps?.join()) this.set({ claps })
    }
    const status = this.follower.status === 'locked' ? 'locked' : this.heardFrom !== null ? 'listening' : 'quiet'
    if (status !== this.state.status) this.set({ status })
    if (this.follower.doubt !== this.state.doubt) this.set({ doubt: this.follower.doubt })
  }
}
