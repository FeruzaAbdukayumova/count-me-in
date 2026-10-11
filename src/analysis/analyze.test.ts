import { describe, expect, it } from 'vitest'
import { analyze, mixToMono } from './analyze'
import { drumLoop } from './testing/drumLoop'
import type { Analysis, Hit } from './types'

const SR = 44100

/** Where a hit lands in the 8-count: '1'–'8', '1½'–'8½', or 'off'. */
function countLabel(h: Hit, r: Analysis): string {
  const k = (h.t - r.anchor) / (60 / r.bpm)
  const nearest = Math.round(k)
  if (Math.abs(k - nearest) < 0.15) return String((((nearest % 8) + 8) % 8) + 1)
  if (Math.abs(k - Math.floor(k) - 0.5) < 0.15) return (((Math.floor(k) % 8) + 8) % 8) + 1 + '½'
  return 'off'
}
const labelsOf = (hits: Hit[], r: Analysis) => [...new Set(hits.map((h) => countLabel(h, r)))].sort()
const list = (l: readonly string[]) => l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]

describe('analyze', () => {
  describe.each([
    { bpm: 78, pattern: 'halftime', boom: ['1', '5'], clap: ['3', '7'] },
    { bpm: 80, pattern: 'halftime', boom: ['1', '5'], clap: ['3', '7'] },
    { bpm: 92, pattern: 'halftime', boom: ['1', '5'], clap: ['3', '7'] },
    { bpm: 100, pattern: 'backbeat', boom: ['1', '3', '5', '7'], clap: ['2', '4', '6', '8'] },
    { bpm: 128, pattern: 'backbeat', boom: ['1', '3', '5', '7'], clap: ['2', '4', '6', '8'] },
  ] as const)('a $bpm BPM $pattern loop', ({ bpm, pattern, boom, clap }) => {
    const r = analyze(drumLoop({ bpm, pattern }), SR)

    it('finds the tempo', () => {
      expect(r.bpm).toBeGreaterThan(bpm - 0.5)
      expect(r.bpm).toBeLessThan(bpm + 0.5)
    })

    it(`puts booms on ${boom.join(', ')}`, () => {
      expect(labelsOf(r.hits[0], r)).toEqual(boom)
    })

    it(`puts claps on ${clap.join(', ')}`, () => {
      expect(labelsOf(r.hits[1], r)).toEqual(clap)
    })

    it('hears a tick on every half count', () => {
      expect(labelsOf(r.hits[2], r)).toHaveLength(16)
      expect(labelsOf(r.hits[2], r)).not.toContain('off')
    })

    it('describes the pattern in plain words', () => {
      expect(r.evidence).toBe(`In this song the deep boom lands on ${list(boom)}, and the clap lands on ${list(clap)}.`)
    })
  })

  // Sweeps the tempos dance classes actually use. Each of these once failed: 78 counted at
  // double speed, 80 put the 1 on the clap, and pop grooves from 118 up counted at half speed.
  it.each(['halftime', 'backbeat'] as const)('counts a %s groove at its real speed from 64 to 124 BPM', (pattern) => {
    const wrong: string[] = []
    for (let bpm = 64; bpm <= 124; bpm += 4) {
      const r = analyze(drumLoop({ bpm, pattern, eights: 3 }), SR)
      if (Math.abs(r.bpm - bpm) > 0.5) wrong.push(`${bpm} → ${r.bpm.toFixed(1)}`)
      else if (labelsOf(r.hits[0], r)[0] !== '1') wrong.push(`${bpm}: 1 is not on a boom`)
    }
    expect(wrong).toEqual([])
  })

  it('finds the 1 after a stretch of silence', () => {
    const leadIn = 1.3
    const r = analyze(drumLoop({ bpm: 100, leadIn }), SR)
    const beat = 60 / r.bpm
    // the anchor may sit a whole 8-count earlier or later; only the phase matters
    const drift = ((r.anchor - leadIn) / (beat * 8)) % 1
    expect(Math.min(Math.abs(drift), 1 - Math.abs(drift))).toBeLessThan(0.05 / (beat * 8))
  })

  it('returns a normalised overview of the song', () => {
    const r = analyze(drumLoop({ bpm: 92 }), SR)
    expect(r.envelope.length).toBeGreaterThan(100)
    expect(Math.max(...r.envelope)).toBeCloseTo(1)
    expect(Math.min(...r.envelope)).toBeGreaterThanOrEqual(0)
  })

  it('does not throw on silence', () => {
    const r = analyze(new Float32Array(SR * 3), SR)
    expect(Number.isFinite(r.bpm)).toBe(true)
    expect(r.evidence).toBe('')
  })
})

describe('mixToMono', () => {
  it('averages the channels', () => {
    const out = mixToMono([Float32Array.of(1, 0, -1), Float32Array.of(0, 0, 1)])
    expect(Array.from(out)).toEqual([0.5, 0, 0])
  })

  it('passes a single channel through untouched', () => {
    const ch = Float32Array.of(0.1, 0.2)
    expect(mixToMono([ch])).toBe(ch)
  })
})
