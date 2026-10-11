import { useCallback, useEffect, useRef } from 'react'
import { cycleLength, effectiveAnchor, type Grid } from '../engine/grid'
import { cssColor, useAnimationFrame, useCanvasSize, useEngine, useEngineState } from './hooks'

/** The whole song as one strip, with a mark on every 8-count. Tap to jump there. */
export function SongStrip() {
  const engine = useEngine()
  const { grid, analysis, duration } = useEngineState()
  const ref = useRef<HTMLCanvasElement>(null)
  // the waveform only changes with the tempo, so it's drawn once offscreen and copied each frame
  const back = useRef<HTMLCanvasElement>(document.createElement('canvas'))

  const redraw = useCallback(() => {
    const cv = ref.current
    if (!cv || !analysis) return
    back.current.width = cv.width
    back.current.height = cv.height
    drawStrip(back.current, analysis.envelope, grid, duration)
  }, [analysis, grid, duration])
  useCanvasSize(ref, redraw)
  useEffect(redraw, [redraw])

  useAnimationFrame(() => {
    const cv = ref.current
    const g = cv?.getContext('2d')
    if (!cv || !g || !duration) return
    g.clearRect(0, 0, cv.width, cv.height)
    g.drawImage(back.current, 0, 0)
    const p = Math.min(Math.max(engine.position(), 0), duration)
    g.fillStyle = cssColor('--ink')
    g.fillRect(Math.round((p / duration) * cv.width), 0, Math.max(2, 1.5 * Math.min(2, devicePixelRatio)), cv.height)
  })

  const jump = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    engine.seek(((e.clientX - r.left) / r.width) * duration)
  }

  return (
    <div className="extra">
      <canvas ref={ref} className="whole" onPointerDown={jump} aria-label="Whole song — tap to jump" />
    </div>
  )
}

function drawStrip(cv: HTMLCanvasElement, env: Float32Array, grid: Grid, duration: number) {
  const g = cv.getContext('2d')
  if (!g || !duration) return
  const { width: W, height: H } = cv
  const mid = H / 2
  const dpr = Math.min(2, devicePixelRatio || 1)
  g.clearRect(0, 0, W, H)
  g.fillStyle = cssColor('--panel')
  g.fillRect(0, 0, W, H)
  g.fillStyle = cssColor('--dim')
  const n = env.length
  for (let x = 0; x < W; x++) {
    const i0 = Math.floor((x / W) * n)
    const i1 = Math.max(i0 + 1, Math.floor(((x + 1) / W) * n))
    let m = 0
    for (let i = i0; i < i1 && i < n; i++) if (env[i] > m) m = env[i]
    const h = Math.max(dpr, m * H * 0.45)
    g.fillRect(x, mid - h, 1, h * 2)
  }
  // a faint mark every 8-count, a strong one every four of them
  const cyc = cycleLength(grid)
  let t = effectiveAnchor(grid)
  t -= Math.ceil(t / cyc) * cyc
  if (t < 0) t += cyc
  for (let k = 0; t < duration; t += cyc, k++) {
    const x = Math.round((t / duration) * W)
    const strong = k % 4 === 0
    g.fillStyle = strong ? 'rgba(255,182,39,.5)' : 'rgba(255,182,39,.15)'
    g.fillRect(x, strong ? 0 : H * 0.32, Math.max(1, Math.round(dpr)), strong ? H : H * 0.36)
  }
}
