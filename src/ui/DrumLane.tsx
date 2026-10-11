import { useRef } from 'react'
import type { Hit } from '../analysis/types'
import { beatLength, countOf, cycleLength, effectiveAnchor, type Grid } from '../engine/grid'
import { cssColor, useAnimationFrame, useCanvasSize, useEngine, useEngineState } from './hooks'

/** The drum hits sliding towards a "now" line, one lane each for booms, claps and ticks. */
export function DrumLane() {
  const engine = useEngine()
  const { grid, analysis } = useEngineState()
  const ref = useRef<HTMLCanvasElement>(null)
  useCanvasSize(ref)
  useAnimationFrame(() => {
    const g = ref.current?.getContext('2d')
    if (g) drawLane(g, grid, analysis?.hits ?? null, engine.position())
  })

  return (
    <div className="extra extra-wide">
      <div className="fallrow">
        <div className="lanelabels" aria-hidden>
          <span className="l1">BOOM</span>
          <span className="l2">CLAP</span>
          <span className="l3">tick</span>
        </div>
        <canvas ref={ref} className="drums" aria-label="Drum hits approaching the beat line" />
      </div>
      {analysis?.evidence && <p className="fallnote">{analysis.evidence}</p>}
    </div>
  )
}

function firstAfter(list: Hit[], t: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (list[m].t < t) lo = m + 1
    else hi = m
  }
  return lo
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, r)
  g.fill()
}

function drawLane(g: CanvasRenderingContext2D, grid: Grid, hits: Hit[][] | null, now: number) {
  const { width: W, height: H } = g.canvas
  if (!W) return
  const k = Math.min(2, window.devicePixelRatio || 1)
  const RULER = 23 * k
  const FOOT = 16 * k
  const laneH = (H - RULER - FOOT) / 3
  const window_ = cycleLength(grid) * 1.45
  const px = W / window_
  const NOWX = Math.round(W * 0.22)
  const t0 = now - NOWX / px
  const t1 = now + (W - NOWX) / px
  const font = (size: number, weight = '') => `${weight}${Math.round(size * k)}px "Instrument Sans",sans-serif`

  g.clearRect(0, 0, W, H)
  g.fillStyle = cssColor('--panel')
  g.fillRect(0, 0, W, H)
  g.fillStyle = cssColor('--panel2')
  g.fillRect(0, 0, W, RULER)

  // the counts, drifting past with the music
  const beat = beatLength(grid)
  const anchor = effectiveAnchor(grid)
  g.textAlign = 'center'
  for (let q = Math.ceil((t0 - anchor) / beat); q <= Math.floor((t1 - anchor) / beat); q++) {
    const x = NOWX + (anchor + q * beat - now) * px
    const one = countOf(q) === 0
    g.globalAlpha = one ? 0.4 : 0.13
    g.fillStyle = cssColor('--ink')
    g.fillRect(Math.round(x), RULER, Math.max(1, k), H - RULER - FOOT)
    g.globalAlpha = 1
    g.fillStyle = one ? cssColor('--warm') : cssColor('--muted')
    g.font = font(one ? 16 : 14, one ? '600 ' : '')
    g.fillText(String(countOf(q) + 1), Math.round(x), 17 * k)
  }

  // one block per drum hit
  if (hits) {
    const colors = [cssColor('--warm'), cssColor('--cool'), cssColor('--ink')]
    hits.forEach((list, lane) => {
      const y0 = RULER + lane * laneH
      for (let i = firstAfter(list, t0); i < list.length && list[i].t <= t1; i++) {
        const h = list[i]
        const bx = NOWX + (h.t - now) * px
        const bw = Math.max(3 * k, Math.min(px * beat * 0.17, 15 * k))
        const bh = Math.max(3 * k, laneH * (0.22 + 0.58 * h.v))
        const live = Math.abs(h.t - now) < 0.065
        g.fillStyle = colors[lane]
        // a streak trailing back the way it came, so a still frame still reads as movement
        if (lane < 2) {
          const ty = y0 + laneH / 2
          const th = Math.max(2 * k, bh * 0.3)
          for (let seg = 1; seg <= 3; seg++) {
            g.globalAlpha = (live ? 0.34 : 0.16 + 0.12 * h.v) / seg
            g.fillRect(bx + bw / 2 + (seg - 1) * 7 * k, ty - th / 2, 6 * k, th)
          }
        }
        g.globalAlpha = live ? 1 : 0.26 + 0.5 * h.v
        roundRect(g, bx - bw / 2, y0 + (laneH - bh) / 2, bw, bh, Math.min(3 * k, bw / 2))
      }
    })
    g.globalAlpha = 1
  }

  // the line where sound meets ear
  g.fillStyle = cssColor('--ink')
  g.fillRect(NOWX, 0, Math.max(2, 1.8 * k), H - FOOT)
  g.beginPath()
  g.moveTo(NOWX - 5 * k, H - FOOT)
  g.lineTo(NOWX + 6 * k, H - FOOT)
  g.lineTo(NOWX, H - FOOT - 6 * k)
  g.closePath()
  g.fill()
  g.textAlign = 'left'
  g.font = font(10, '600 ')
  g.fillStyle = cssColor('--muted')
  g.fillText('you hear it here', NOWX + 9 * k, H - 4 * k)
  g.fillStyle = cssColor('--dim')
  g.font = font(10)
  g.textAlign = 'right'
  g.fillText('‹‹‹  on its way', W - 6 * k, H - 4 * k)
}
