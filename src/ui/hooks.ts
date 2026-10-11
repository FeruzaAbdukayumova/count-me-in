import { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react'
import type { CountEngine, EngineState } from '../engine/CountEngine'

export const EngineContext = createContext<CountEngine | null>(null)

export function useEngine(): CountEngine {
  const engine = useContext(EngineContext)
  if (!engine) throw new Error('useEngine must be used inside <EngineContext.Provider>')
  return engine
}

/** Re-renders when the engine's state changes — tempo, running, options. Not every frame. */
export function useEngineState(): EngineState {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

/** Calls `fn` on every animation frame while mounted. Always calls the latest `fn`. */
export function useAnimationFrame(fn: () => void): void {
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  useEffect(() => {
    let id = 0
    const loop = () => {
      latest.current()
      id = requestAnimationFrame(loop)
    }
    id = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(id)
  }, [])
}

/** Keeps a canvas's backing store at its on-screen size × device pixel ratio (max 2). */
export function useCanvasSize(ref: React.RefObject<HTMLCanvasElement | null>, onResize?: () => void): void {
  const latest = useRef(onResize)
  useEffect(() => {
    latest.current = onResize
  })
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.round(Math.max(160, cv.clientWidth) * dpr)
      cv.height = Math.round(Math.max(40, cv.clientHeight) * dpr)
      latest.current?.()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(cv)
    return () => ro.disconnect()
  }, [ref])
}

/** CSS custom properties, read once — canvases can't use var() directly. */
let palette: Record<string, string> | null = null
export function cssColor(name: string): string {
  if (!palette) {
    const cs = getComputedStyle(document.documentElement)
    palette = {}
    for (const v of ['--panel', '--panel2', '--dim', '--line', '--muted', '--warm', '--cool', '--ink']) {
      palette[v] = cs.getPropertyValue(v).trim()
    }
  }
  return palette[name] ?? ''
}
