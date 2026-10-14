import { describe, expect, it } from 'vitest'
import type { Grid } from '../engine/grid'
import { ClapRound, clapCounts, sayCounts } from './clap'

// 120 bpm: a beat every half second, a 1 at 10 s
const grid: Grid = { bpm: 120, anchor: 10, offsetMs: 0 }
const at = (beat: number) => 10 + beat * 0.5

/** Claps on `counts` (0–7) through `eights` 8s, with a little timing wobble. */
function claps(counts: number[], eights = 4) {
  const out: number[] = []
  for (let e = 0; e < eights; e++) for (const c of counts) out.push(at(e * 8 + c) + (((e + c) % 3) - 1) * 0.02)
  return out
}

describe('clapCounts', () => {
  it('finds a hip hop clap on 3 and 7', () => {
    expect(clapCounts(claps([2, 6]), grid)).toEqual([2, 6])
  })

  it('finds a clap on every even number', () => {
    expect(clapCounts(claps([1, 3, 5, 7]), grid)).toEqual([1, 3, 5, 7])
  })

  it('ignores the odd stray clap', () => {
    expect(clapCounts([...claps([2, 6]), at(4), at(13)], grid)).toEqual([2, 6])
  })

  it('says nothing about a few claps, or claps between the counts', () => {
    expect(clapCounts(claps([2, 6], 2), grid)).toBeNull()
    expect(clapCounts(claps([2, 6]).map((t) => t + 0.25), grid)).toBeNull()
  })

  it('says nothing when the claps land on the 1, because then our 1 is off', () => {
    expect(clapCounts(claps([0, 4]), grid)).toBeNull()
  })
})

it('says the counts the way a dancer does', () => {
  expect(sayCounts([2, 6])).toBe('3 and 7')
  expect(sayCounts([1, 3, 5, 7])).toBe('2, 4, 6 and 8')
})

describe('ClapRound', () => {
  it('counts taps on the clap, names the count, and finishes after its claps', () => {
    const r = new ClapRound([2, 6], 4)
    for (let b = 0; b < 16; b++) r.beat(at(b), b % 8, 0.5)
    expect(r.heard).toBe(4)
    expect(r.tap(at(2) + 0.05, grid)).toEqual({ kind: 'hit', count: 2 })
    expect(r.tap(at(2) + 0.06, grid)).toBeNull() // one clap, one answer
    expect(r.tap(at(6) - 0.2, grid)).toEqual({ kind: 'early', count: 6 })
    expect(r.tap(at(10) + 0.2, grid)).toEqual({ kind: 'late', count: 2 })
    expect(r.tap(at(11), grid)).toEqual({ kind: 'wrong', count: 3 })
    expect(r.finished).toBe(false)
    expect(r.missed(at(14) + 0.4)).toEqual([6])
    expect(r.finished).toBe(true)
    expect(r.hits).toBe(1)
  })

  it('takes a tap that comes just before the clap', () => {
    const r = new ClapRound([2, 6])
    r.beat(at(1), 1, 0.5)
    expect(r.tap(at(2) - 0.05, grid)).toEqual({ kind: 'hit', count: 2 })
    r.beat(at(2), 2, 0.5) // the frame for that beat arrives after the tap
    expect(r.heard).toBe(1)
  })

  it('stops collecting claps once the round is full', () => {
    const r = new ClapRound([2, 6], 2)
    for (let b = 0; b < 24; b++) r.beat(at(b), b % 8, 0.5)
    expect(r.heard).toBe(2)
  })
})
