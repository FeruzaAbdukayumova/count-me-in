import { describe, expect, it } from 'vitest'
import { drumLoop, type DrumPattern } from '../analysis/testing/drumLoop'
import { estimateWindow } from './estimate'
import { BeatFollower, type Lock } from './follow'

const SR = 22050
const WINDOW = 20
const STEP = 2
const FIRST = 6

/**
 * Plays a loop "into the microphone": quieter than the file, with room noise, and the
 * listening starts partway into the song rather than on a 1. Returns every lock the
 * follower produced and when.
 */
function listen(opts: { bpm: number; pattern: DrumPattern; joinAt: number; seconds: number }) {
  const beat = 60 / opts.bpm
  const eights = Math.ceil((opts.joinAt + opts.seconds) / (beat * 8)) + 1
  const song = drumLoop({ bpm: opts.bpm, pattern: opts.pattern, eights, sampleRate: SR })
  let seed = 5
  const room = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02
  // the clock reads `joinAt` seconds of song time when we start listening (any offset works)
  const clockAtJoin = 100
  const toClock = (songTime: number) => clockAtJoin + (songTime - opts.joinAt)

  const follower = new BeatFollower()
  const locks: { at: number; lock: Lock }[] = []
  for (let heard = FIRST; heard <= opts.seconds; heard += STEP) {
    const from = Math.max(0, heard - WINDOW)
    const a = Math.floor((opts.joinAt + from) * SR)
    const b = Math.floor((opts.joinAt + heard) * SR)
    const win = song.slice(a, b).map((v) => v * 0.35 + room())
    const est = estimateWindow(win, SR, toClock(opts.joinAt + from))
    const lock = est && follower.feed(est)
    if (lock) locks.push({ at: heard, lock })
  }
  // where the song's real 1s fall on the clock
  const trueOne = toClock(0)
  return { follower, locks, beat, trueOne }
}

/**
 * How far a lock's 1 is from a beat that could be the 1, in seconds (0 = spot on). The loops
 * repeat every `period` beats, so nothing in the audio says which of those is the real 1.
 */
function oneError(lock: Lock, trueOne: number, beat: number, period: number) {
  const cyc = beat * period
  const k = (lock.anchor - trueOne) / cyc
  return Math.abs(k - Math.round(k)) * cyc
}

describe('BeatFollower on a song heard through the microphone', () => {
  describe.each([
    { bpm: 80, pattern: 'halftime', joinAt: 3.3 },
    { bpm: 92, pattern: 'halftime', joinAt: 7.1 },
    { bpm: 100, pattern: 'backbeat', joinAt: 1.9 },
    { bpm: 128, pattern: 'backbeat', joinAt: 5.55 },
  ] as const)('$bpm BPM $pattern, joined $joinAt s in', (c) => {
    const { follower, locks, beat, trueOne } = listen({ ...c, seconds: 30 })
    const period = c.pattern === 'halftime' ? 4 : 2

    // a fast song first read at half speed waits one window more, until its 8 can be checked
    it('locks within about 12 seconds', () => {
      expect(locks.length).toBeGreaterThan(0)
      expect(locks[0].at).toBeLessThanOrEqual(FIRST + 3 * STEP)
    })

    it('ends on the right tempo', () => {
      expect(follower.lock!.bpm).toBeGreaterThan(c.bpm - 0.6)
      expect(follower.lock!.bpm).toBeLessThan(c.bpm + 0.6)
    })

    it('puts the 1 on a beat where the groove starts over, and keeps it there', () => {
      for (const { lock } of locks) expect(oneError(lock, trueOne, beat, period)).toBeLessThan(0.03)
      const ones = locks.map(({ lock }) => Math.round((lock.anchor - locks[0].lock.anchor) / beat))
      expect(ones.every((n) => n % 8 === 0)).toBe(true)
    })
  })

  it('stays locked when one window comes out wrong', () => {
    const f = new BeatFollower()
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 10 + (60 / 92) * 8 })
    const before = f.lock!
    expect(f.feed({ bpm: 61, one: 13.37 })).toBeNull()
    expect(f.status).toBe('locked')
    expect(f.lock).toEqual(before)
  })

  it('never moves the 1 by itself, however many windows say it is somewhere else', () => {
    const f = new BeatFollower()
    const beat = 60 / 92
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 10 + beat * 8 })
    const one = f.lock!.anchor
    // four windows in a row that all say the 1 is really on what we call 3
    for (let i = 2; i < 6; i++) f.feed({ bpm: 92, one: 10 + beat * (8 * i + 2), sure: true })
    expect(Math.round(((((f.lock!.anchor - one) / beat) % 8) + 8) % 8)).toBe(0)
  })

  it('never swaps the 1 and the 5 by itself', () => {
    const f = new BeatFollower()
    const beat = 60 / 92
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 10 + beat * 8 })
    for (let i = 2; i < 6; i++) f.feed({ bpm: 92, one: 10 + beat * (8 * i + 4) })
    expect(Math.round((((f.lock!.anchor - 10) / beat) % 8 + 8) % 8)).toBe(0)
  })

  it('keeps the 1 where the dancer put it', () => {
    const f = new BeatFollower()
    const beat = 60 / 92
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 10 + beat * 8 })
    f.override(10 + beat * 9)
    for (let i = 2; i < 6; i++) f.feed({ bpm: 92, one: 10 + beat * 8 * i })
    expect(Math.round((((f.lock!.anchor - 10) / beat) % 8 + 8) % 8)).toBe(1)
  })

  it('holds its tempo when later windows disagree', () => {
    const f = new BeatFollower()
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 15.2 })
    for (let i = 0; i < 5; i++) expect(f.feed({ bpm: 120, one: 20 + i * 2 })).toBeNull()
    expect(f.status).toBe('locked')
    expect(f.lock!.bpm).toBeCloseTo(92, 0)
    expect(f.doubt).toBe(false)
  })

  it('keeps counting when it hears nothing it can agree with', () => {
    const f = new BeatFollower()
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 15.2 })
    for (const bpm of [105, 82, 160]) f.feed({ bpm, one: 20 })
    expect(f.status).toBe('locked')
  })

  it('suspects a different song after a long run of windows that agree with each other but not with it', () => {
    const f = new BeatFollower()
    f.feed({ bpm: 92, one: 10 })
    f.feed({ bpm: 92, one: 15.2 })
    // the new song's windows agree on the tempo but not on where its beats fall
    for (let i = 0; i < 8; i++) f.feed({ bpm: 120, one: 20 + i * 2 + (i % 2) * 0.25 })
    expect(f.doubt).toBe(true)
    expect(f.status).toBe('locked')
    f.feed({ bpm: 92, one: 15.2 + (60 / 92) * 40 })
    expect(f.doubt).toBe(false)
  })

  it('ignores a quiet room', () => {
    expect(estimateWindow(new Float32Array(SR * 8), SR, 0)).toBeNull()
  })
})

describe('BeatFollower in a busy section of the same song', () => {
  it('keeps counting through a run of triplet readings', () => {
    const f = new BeatFollower()
    const beat = 60 / 112
    for (let i = 0; i < 6; i++) f.feed({ bpm: 112, one: 10 + beat * 8 * i })
    for (let i = 0; i < 8; i++) f.feed({ bpm: 74.7, one: 40 + i * 2 })
    expect(f.status).toBe('locked')
    expect(f.lock!.bpm).toBeCloseTo(112, 0)
  })

  it('waits for windows long enough to have checked the tempo before locking', () => {
    const f = new BeatFollower()
    const beat = 60 / 74.7
    f.feed({ bpm: 74.7, one: 10, checked: false })
    expect(f.feed({ bpm: 74.7, one: 10 + beat * 8, checked: false })).toBeNull()
    expect(f.status).toBe('listening')
    expect(f.feed({ bpm: 74.7, one: 10 + beat * 16, checked: true })).toMatchObject({ bpm: expect.any(Number) })
  })
})
