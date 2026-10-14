import { useEffect, useRef } from 'react'
import { CYCLE, beatIndexAt, beatLength, countOf, cycleProgress, effectiveAnchor, isFocused } from '../engine/grid'
import type { ListenState } from '../listen/Listener'
import { DrumLane } from './DrumLane'
import { useAnimationFrame, useEngine, useEngineState } from './hooks'
import { SongStrip } from './SongStrip'

export type HintKey = 'ready' | 'placeone' | 'fixed' | 'sounds' | 'onlyone' | 'listening'

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
  listening: (
    <>
      I've got the beat and I'll hold it. If the <b>1</b> feels wrong, press the button below when the music starts
      over.
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
  listen: ListenState
  onMarkOne: () => void
  onStopListening: () => void
  onFindAgain: () => void
}

export function CountView({ hint, showDrums, showWhole, listen, onMarkOne, onStopListening, onFindAgain }: Props) {
  const engine = useEngine()
  const { running, mode, options } = useEngineState()
  const numRef = useRef<HTMLDivElement>(null)
  const boxesRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLElement>(null)
  const last = useRef<{ start: number; count: number } | null>(null)

  // Runs every frame, so it writes to the DOM directly instead of going through React state.
  useAnimationFrame(() => {
    const { grid, running, options } = engine.getState()
    const p = engine.position()
    const beat = running ? beatIndexAt(grid, p) : 0
    const count = countOf(beat)
    const num = numRef.current
    // a beat is known by when it started, not its index: the microphone keeps re-basing the
    // grid, which renumbers beats without moving them, and a nudge of a few ms across a
    // beat's start shouldn't flash the same number twice
    const start = effectiveAnchor(grid) + beat * beatLength(grid)
    const prev = last.current
    const same = prev !== null && prev.count === count && Math.abs(start - prev.start) < beatLength(grid) / 2
    if (num && !same) {
      last.current = { start, count }
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

      {mode === 'listen' && (
        <p className={'livenote' + (listen.hearing && !listen.doubt ? '' : ' lost')} role="status">
          <i aria-hidden />
          {listen.doubt
            ? "This doesn't sound like the song I'm counting. New song? Find the beat again."
            : listen.hearing
              ? 'Listening'
              : "Can't hear the music. Still counting."}
        </p>
      )}

      <div className="actions">
        {mode === 'listen' ? (
          <button className="primary stop" onClick={onStopListening}>
            Stop listening
          </button>
        ) : (
          <button className={'primary' + (running ? ' stop' : '')} onClick={() => engine.toggle()}>
            {running ? 'Stop' : 'Start'}
          </button>
        )}
        <button className="txtbtn" onClick={onMarkOne}>
          It's off — tap on the 1
        </button>
        {mode === 'listen' && (
          <button className="txtbtn" onClick={onFindAgain}>
            Find the beat again
          </button>
        )}
      </div>
    </div>
  )
}
