import { TAPS_NEEDED } from '../engine/grid'
import { useEngineState } from './hooks'

interface Props {
  onTap: () => void
  onBack: () => void
}

export function TapView({ onTap, onBack }: Props) {
  const { taps } = useEngineState()
  return (
    <div className="view">
      <p className="say">
        Start the music, then tap this <b>in time with it</b>.
      </p>
      <p className="sub">Like clapping along. Any four beats will do — you don't have to start anywhere special.</p>
      <button
        className="pad"
        onClick={onTap}
        onTouchStart={(e) => {
          // fire on touch-down: waiting for the click adds ~100ms and drags the tempo
          e.preventDefault()
          onTap()
        }}
      >
        Tap
      </button>
      <div className="tapdots" role="progressbar" aria-valuenow={taps} aria-valuemax={TAPS_NEEDED} aria-label="Taps">
        {Array.from({ length: TAPS_NEEDED }, (_, i) => (
          <i key={i} className={i < taps ? 'on' : ''} />
        ))}
      </div>
      <button className="txtbtn" onClick={onBack}>
        Back
      </button>
    </div>
  )
}
