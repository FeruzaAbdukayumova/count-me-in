import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CYCLE, beatIndexAt, beatLength, countOf, effectiveAnchor } from '../engine/grid'
import { ClapRound, sayCounts, type TapResult } from '../learn/clap'
import type { Listener } from '../listen/Listener'
import { useAnimationFrame, useEngine } from './hooks'

/** Two 8s of watching before it's your turn. */
const SHOW_BEATS = 16
const ROUND_CLAPS = 8
/** This many claps out of ROUND_CLAPS and you can hear it. */
const GOOD = 6
/** Locked on the beat for this long with no clear clap: this song probably hasn't got one. */
const NO_CLAP_MS = 30000

type Phase = 'wait' | 'show' | 'try' | 'done'

interface Feedback {
  text: React.ReactNode
  good: boolean
}

function feedbackFor(r: TapResult): Feedback {
  const n = <b>{r.count + 1}</b>
  if (r.kind === 'hit') return { text: <>Yes! That clap is {n}.</>, good: true }
  if (r.kind === 'wrong') return { text: <>That was {n}. No clap there.</>, good: false }
  return { text: <>A bit {r.kind}. That clap is {n}.</>, good: false }
}

interface Props {
  listener: Listener
  onBack: () => void
}

/**
 * Lesson: hear the clap. It shows where this song's clap lands in the 8, then hides the
 * numbers and checks you tap on every clap, telling you which number each one was.
 */
export function LessonView({ listener, onBack }: Props) {
  const engine = useEngine()
  const { status, claps } = useSyncExternalStore(listener.subscribe, listener.getState)
  const [phase, setPhase] = useState<Phase>('wait')
  const [count, setCount] = useState(0)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [heard, setHeard] = useState(0)
  const [hits, setHits] = useState(0)

  const pattern = useRef<number[]>([])
  const round = useRef<ClapRound | null>(null)
  const beats = useRef(0)
  const last = useRef<{ start: number; count: number } | null>(null)

  const [noClap, setNoClap] = useState(false)

  // locked on the beat but no clear clap yet: a song without one would wait forever
  useEffect(() => {
    if (phase !== 'wait' || status !== 'locked' || claps) return
    const t = setTimeout(() => setNoClap(true), NO_CLAP_MS)
    return () => clearTimeout(t)
  }, [phase, status, claps])

  useAnimationFrame(() => {
    // the clap pattern is known: start the lesson
    const heardNow = listener.getState()
    if (phase === 'wait' && heardNow.status === 'locked' && heardNow.claps) {
      pattern.current = heardNow.claps
      beats.current = 0
      setPhase('show')
      return
    }
    const { grid, running } = engine.getState()
    if (!running || (phase !== 'show' && phase !== 'try')) return
    const p = engine.position()
    const b = beatIndexAt(grid, p)
    const c = countOf(b)
    const start = effectiveAnchor(grid) + b * beatLength(grid)
    // the same beat can be renumbered when the microphone re-bases the grid (see CountView)
    const prev = last.current
    const isNew = !(prev && prev.count === c && Math.abs(start - prev.start) < beatLength(grid) / 2)
    if (isNew) {
      last.current = { start, count: c }
      setCount(c)
      beats.current++
      if (phase === 'show' && beats.current > SHOW_BEATS && c === 0) startRound()
    }
    const r = round.current
    if (phase === 'try' && r) {
      r.beat(start, c, beatLength(grid))
      const missed = r.missed(p)
      if (missed.length) setFeedback({ text: <>Missed the clap on <b>{missed[missed.length - 1] + 1}</b>.</>, good: false })
      if (r.heard !== heard) setHeard(r.heard)
      if (r.finished) {
        setHits(r.hits)
        setPhase('done')
      }
    }
  })

  function startRound() {
    round.current = new ClapRound(pattern.current, ROUND_CLAPS)
    setFeedback(null)
    setHeard(0)
    setHits(0)
    setPhase('try')
  }

  function watchAgain() {
    beats.current = 0
    setPhase('show')
  }

  const tap = () => {
    const r = round.current
    if (phase !== 'try' || !r) return
    const result = r.tap(engine.audio().currentTime, engine.getState().grid)
    if (result) setFeedback(feedbackFor(result))
  }
  const tapRef = useRef(tap)
  useEffect(() => {
    tapRef.current = tap
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      tapRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const where = sayCounts(pattern.current)
  const lost = (phase === 'show' || phase === 'try') && status !== 'locked'

  return (
    <div className="view lesson">
      {phase === 'wait' && <Waiting status={status} noClap={noClap} />}

      {phase === 'show' && (
        <>
          <div className="pill">Step 1 of 2 · watch and listen</div>
          <p className="say">
            In this song the clap lands on <b>{where}</b>.
          </p>
          <div className={'num' + (count >= 4 ? ' second' : '')} aria-hidden>
            {count + 1}
          </div>
          <div className="boxes" aria-hidden>
            {Array.from({ length: CYCLE }, (_, i) => (
              <div key={i} className={'box' + (i >= 4 ? ' second' : '') + (i === count ? ' lit' : '')}>
                {i + 1}
                {pattern.current.includes(i) && <span className="claptag">CLAP</span>}
              </div>
            ))}
          </div>
          <p className="hint" role="status">
            {pattern.current.includes(count) ? (
              <>
                Clap → that's <b>{count + 1}</b>.
              </>
            ) : (
              <>The clap is the sharp sound, like hands clapping. It comes back in the same place every 8.</>
            )}
          </p>
        </>
      )}

      {phase === 'try' && (
        <>
          <div className="pill">Step 2 of 2 · your turn</div>
          <p className="say">
            Tap on every <b>clap</b>.
          </p>
          <p className="sub">No numbers now. Just listen. I'll tell you which number each clap was.</p>
          <button
            className="pad"
            onClick={tap}
            onTouchStart={(e) => {
              // fire on touch-down: waiting for the click adds ~100ms and every tap would read late
              e.preventDefault()
              tap()
            }}
          >
            Tap
          </button>
          <p className={'feedback' + (feedback?.good ? ' good' : '')} role="status">
            {feedback?.text}
          </p>
          <div className="tapdots" role="progressbar" aria-valuenow={heard} aria-valuemax={ROUND_CLAPS} aria-label="Claps">
            {Array.from({ length: ROUND_CLAPS }, (_, i) => (
              <i key={i} className={i < heard ? 'on' : ''} />
            ))}
          </div>
        </>
      )}

      {phase === 'done' && (
        <>
          <p className="say">
            <b>{hits}</b> of {ROUND_CLAPS} claps.
          </p>
          <p className="sub">
            {hits >= GOOD ? (
              <>
                You can hear it. In this song a clap means <b>{sayCounts(pattern.current).replace(' and ', ' or ')}</b>,
                so when you lose count, the next clap tells you where you are.
              </>
            ) : (
              <>Listen for the sharp sound, like hands clapping. Watch it once more, then try again.</>
            )}
          </p>
          <div className="actions">
            {hits >= GOOD ? (
              <button className="primary" onClick={startRound}>
                Again
              </button>
            ) : (
              <button className="primary" onClick={watchAgain}>
                Watch again
              </button>
            )}
            {hits >= GOOD ? (
              <button className="txtbtn" onClick={watchAgain}>
                Watch again
              </button>
            ) : (
              <button className="txtbtn" onClick={startRound}>
                Try again
              </button>
            )}
          </div>
        </>
      )}

      {lost && (
        <p className="livenote lost" role="status">
          <i aria-hidden />
          Lost the beat. Still listening…
        </p>
      )}

      <div className="actions">
        <button className="txtbtn" onClick={onBack}>
          {phase === 'done' ? 'Done' : 'Stop the lesson'}
        </button>
      </div>
    </div>
  )
}

function Waiting({ status, noClap }: { status: string; noClap: boolean }) {
  return (
    <>
      <div className="pill">Lesson · hear the clap</div>
      <p className="say" role="status">
        {status === 'asking' && <>Allow the microphone, so I can hear the music.</>}
        {(status === 'quiet' || status === 'off') && (
          <>
            Play a song <b>out loud</b>. One with a clap works best.
          </>
        )}
        {status === 'listening' && <>I can hear it. Finding the beat…</>}
        {status === 'locked' &&
          (noClap ? <>I can't hear a clear clap in this song. Try another one.</> : <>Got the beat. Listening for the clap…</>)}
        {status === 'denied' && <>The microphone is blocked, so I can't hear the music.</>}
        {status === 'unsupported' && <>This browser can't listen to the microphone.</>}
      </p>
      <p className="sub">
        {status === 'denied'
          ? 'Allow it in your browser settings for this site.'
          : status === 'unsupported'
            ? 'Try Safari on iPhone or Chrome.'
            : 'Most hip hop songs have one: a sharp sound, like hands clapping. Keep the music going.'}
      </p>
    </>
  )
}
