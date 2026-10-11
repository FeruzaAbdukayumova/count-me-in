export type TickKind = 'one' | 'five' | 'num' | 'ghost' | 'tap'

const TICKS: Record<TickKind, { hz: number; gain: number; length: number }> = {
  one: { hz: 1700, gain: 0.95, length: 0.075 },
  five: { hz: 1150, gain: 0.68, length: 0.045 },
  num: { hz: 880, gain: 0.48, length: 0.045 },
  ghost: { hz: 620, gain: 0.12, length: 0.045 },
  tap: { hz: 1400, gain: 0.8, length: 0.045 },
}

/** A short square-wave click at audio-clock time `t`, louder and higher on the 1. */
export function playTick(ctx: AudioContext, out: AudioNode, t: number, kind: TickKind): void {
  const { hz, gain, length } = TICKS[kind]
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = hz
  env.gain.setValueAtTime(0, t)
  env.gain.linearRampToValueAtTime(gain * 0.5, t + 0.002)
  env.gain.exponentialRampToValueAtTime(0.0008, t + length)
  osc.connect(env).connect(out)
  osc.start(t)
  osc.stop(t + 0.1)
}

const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
/** Speech engines take roughly this long to start talking. */
const SPEECH_LATENCY_MS = 110

/** Says the count out loud so it lands about when the tick does. */
export function speakCount(count: number, msAway: number): void {
  if (!('speechSynthesis' in window)) return
  setTimeout(
    () => {
      try {
        if (speechSynthesis.pending) speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(WORDS[count])
        u.rate = 1.45
        u.pitch = count === 0 ? 1.15 : 1
        speechSynthesis.speak(u)
      } catch {
        // speech is a nice-to-have; never let it break the counting
      }
    },
    Math.max(0, msAway - SPEECH_LATENCY_MS),
  )
}

export function stopSpeaking(): void {
  if ('speechSynthesis' in window) {
    try {
      speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }
}

/** iOS only lets a page speak after it has spoken inside a tap; this silent line unlocks it. */
export function unlockSpeech(): void {
  if (!('speechSynthesis' in window)) return
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    speechSynthesis.speak(u)
  } catch {
    // ignore
  }
}
