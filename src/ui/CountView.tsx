import { useEffect, useRef } from 'react'
import { CYCLE, beatIndexAt, countOf, cycleProgress, isFocused } from '../engine/grid'
import { DrumLane } from './DrumLane'
import { useAnimationFrame, useEngine, useEngineState } from './hooks'
import { SongStrip } from './SongStrip'

export type HintKey = 'ready' | 'placeone' | 'fixed' | 'sounds' | 'onlyone'

const HINTS: Record<HintKey, React.ReactNode> = {
  ready: (
    <>
      Watch for <b>1</b>. That is where the music starts over — nod your head every time it comes round.
    </>
  ),
  placeone: (
    <>
      The speed is right, but the numbers may not line up yet. When you feel the music <b>start over</b>, press the
      button below once.
    </>
  ),
  fixed: (
    <>
      Now <b>1</b> is where you said it was. Nod on every 1 and let the rest go past.
    </>
  ),
  sounds: <>A block crossing the line is the sound you hear right then.</>,
  onlyone: (
    <>
      Only the <b>1</b> lights up. Ignore the rest — this is the whole skill.
    </>
  ),
}

interface Props {
  hint: HintKey
  showDrums: boolean
  showWhole: boolean
  onMarkOne: () => void
}

export function CountView({ hint, showDrums, showWhole, onMarkOne }: Props) {
  const engine = useEngine()
  const { running, mode, options } = useEngineState()
  const numRef = useRef<HTMLDivElement>(null)
  const boxesRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  const last = useRef<number | null>(null)

  // Runs every frame, so it writes to the DOM directly instead of going through React state.
  useAnimationFrame(() => {
    const { grid, running, options } = engine.getState()
    const p = engine.position()
    const beat = running ? beatIndexAt(grid, p) : 0
    const count = countOf(beat)
    const num = numRef.current
    if (num && beat !== last.current) {
      last.current = beat
      num.textContent = String(count + 1)
      num.classList.toggle('second', count >= 4)
      num.classList.toggle('resting', !(running && isFocused(options.focus, count)))
      if (running) {
        num.classList.remove('beat')
        void num.offsetWidth // restart the CSS animation
        num.classList.add('beat')
      }
      boxesRef.current?.querySelectorAll('.box').forEach((b, i) => b.classList.toggle('lit', running && i === count))
    }
    if (barRef.current) {
      barRef.current.style.transform = `scaleX(${running ? cycleProgress(grid, p).toFixed(4) : 0})`
    }
  })

  const lane = mode === 'file' && showDrums
  // these re-render the number and boxes with fresh classes; repaint the current count on the next frame
  useEffect(() => {
    last.current = null
  }, [lane, options.focus, running])

  return (
    <div className="view">
      {/* text is written by the animation loop, not React */}
      <div ref={numRef} className={'num resting' + (lane ? ' small' : '')} aria-hidden />

      {!lane && (
        <>
          <div ref={boxesRef} className="boxes" aria-hidden>
            {Array.from({ length: CYCLE }, (_, i) => (
              <div
                key={i}
                className={
                  'box' +
                  (i === 0 ? ' first' : '') +
                  (i >= 4 ? ' second' : '') +
                  (isFocused(options.focus, i) ? '' : ' quiet')
                }
              >
                {i + 1}
              </div>
            ))}
          </div>
          <div className="progress">
            <i ref={barRef} />
          </div>
        </>
      )}

      <p className="hint">{HINTS[hint]}</p>

      {lane && <DrumLane />}
      {mode === 'file' && showWhole && <SongStrip />}

      <div className="actions">
        <button className={'primary' + (running ? ' stop' : '')} onClick={() => engine.toggle()}>
          {running ? 'Stop' : 'Start'}
        </button>
        <button className="txtbtn" onClick={onMarkOne}>
          It's off — tap on the 1
        </button>
      </div>
    </div>
  )
}
