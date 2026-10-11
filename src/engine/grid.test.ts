import { describe, expect, it } from 'vitest'
import {
  beatIndexAt,
  clampBpm,
  clampOffset,
  countOf,
  cycleProgress,
  isFocused,
  nearestOne,
  tempoFromTaps,
  type Grid,
} from './grid'

const grid: Grid = { bpm: 120, anchor: 1, offsetMs: 0 }

describe('beatIndexAt', () => {
  it('counts beats from the anchor', () => {
    expect(beatIndexAt(grid, 1)).toBe(0)
    expect(beatIndexAt(grid, 1.49)).toBe(0)
    expect(beatIndexAt(grid, 1.5)).toBe(1)
    expect(beatIndexAt(grid, 0.9)).toBe(-1)
  })

  it('moves with the nudge', () => {
    expect(beatIndexAt({ ...grid, offsetMs: 100 }, 1.05)).toBe(-1)
  })
})

describe('countOf', () => {
  it('wraps every 8 beats, including before the anchor', () => {
    expect([0, 7, 8, 9, -1, -8].map(countOf)).toEqual([0, 7, 0, 1, 7, 0])
  })
})

describe('cycleProgress', () => {
  it('runs from 0 to 1 over each 8-count', () => {
    expect(cycleProgress(grid, 1)).toBe(0)
    expect(cycleProgress(grid, 3)).toBeCloseTo(0.5)
    expect(cycleProgress(grid, 0)).toBeCloseTo(0.75)
  })
})

describe('isFocused', () => {
  it('lights every count, only 1 and 5, or only 1', () => {
    const lit = (f: Parameters<typeof isFocused>[0]) => [0, 1, 2, 3, 4, 5, 6, 7].filter((c) => isFocused(f, c))
    expect(lit('all')).toHaveLength(8)
    expect(lit('onefive')).toEqual([0, 4])
    expect(lit('one')).toEqual([0])
  })
})

describe('nearestOne', () => {
  it('snaps to the closest 1', () => {
    expect(nearestOne(grid, 4.9, 60)).toBeCloseTo(5)
    expect(nearestOne(grid, 2.9, 60)).toBeCloseTo(1)
  })

  it('never goes before the start of the song or past its end', () => {
    expect(nearestOne({ ...grid, anchor: 3 }, 0, 60)).toBeCloseTo(3)
    expect(nearestOne(grid, 100, 10)).toBeCloseTo(9.95)
  })
})

describe('tempoFromTaps', () => {
  const taps = (gap: number, n = 4) => Array.from({ length: n }, (_, i) => i * gap)

  it('needs at least two taps', () => {
    expect(tempoFromTaps([1])).toBeNull()
  })

  it('reads steady taps', () => {
    expect(tempoFromTaps(taps(0.6))).toBeCloseTo(100)
  })

  it('ignores one sloppy tap', () => {
    expect(tempoFromTaps([0, 0.6, 1.2, 1.55, 2.4])).toBeCloseTo(100)
  })

  it('doubles when tapping every other beat of a fast song', () => {
    expect(tempoFromTaps(taps(1.2))).toBeCloseTo(100)
  })

  it('gives up instead of hanging when the taps carry no time', () => {
    expect(tempoFromTaps([5, 5, 5, 5])).toBeNull()
    expect(tempoFromTaps([5, 5.01, 5.02, 5.03])).toBeNull()
  })

  it('halves when tapping twice per beat', () => {
    expect(tempoFromTaps(taps(0.25))).toBeCloseTo(120)
  })
})

describe('clamps', () => {
  it('keep tempo and nudge in range', () => {
    expect(clampBpm(10)).toBe(30)
    expect(clampBpm(999)).toBe(260)
    expect(clampOffset(-1000)).toBe(-400)
    expect(clampOffset(50)).toBe(50)
  })
})
