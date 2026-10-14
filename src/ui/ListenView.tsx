import { useSyncExternalStore } from 'react'
import type { Listener } from '../listen/Listener'

/** About how long it takes to find the beat, for the progress dots. */
const SECONDS_TO_FIND = 8

interface Props {
  listener: Listener
  onTapInstead: () => void
  onBack: () => void
}

/** Shown while the microphone is looking for the beat. Once it's found, the count screen takes over. */
export function ListenView({ listener, onTapInstead, onBack }: Props) {
  const { status, heard } = useSyncExternalStore(listener.subscribe, listener.getState)
  const blocked = status === 'denied' || status === 'unsupported'

  return (
    <div className="view">
      <div className={'mic' + (status === 'listening' ? ' hearing' : '') + (blocked ? ' blocked' : '')} aria-hidden>
        <MicIcon />
      </div>

      <p className="say" role="status">
        {status === 'asking' && <>Allow the microphone, so I can hear the music.</>}
        {(status === 'quiet' || status === 'off') && (
          <>
            Play your song <b>out loud</b>.
          </>
        )}
        {status === 'listening' && (
          <>
            I can hear it. Finding the <b>1</b>…
          </>
        )}
        {status === 'denied' && <>The microphone is blocked, so I can't hear the music.</>}
        {status === 'unsupported' && <>This browser can't listen to the microphone.</>}
      </p>
      <p className="sub">
        {(status === 'quiet' || status === 'asking' || status === 'off') &&
          'From Spotify, YouTube, a speaker in class: anything I can hear. Put the phone where it can hear it.'}
        {status === 'listening' && 'Keep the music going. This takes about ten seconds.'}
        {status === 'denied' && 'Allow it in your browser settings for this site, or tap along instead.'}
        {status === 'unsupported' && 'Tap along instead: it works everywhere.'}
      </p>

      {status === 'listening' && (
        <div className="tapdots" role="progressbar" aria-valuenow={heard} aria-valuemax={SECONDS_TO_FIND} aria-label="Listening">
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} className={heard >= ((i + 1) * SECONDS_TO_FIND) / 4 ? 'on' : ''} />
          ))}
        </div>
      )}

      <div className="actions">
        {blocked && (
          <button className="primary" onClick={onTapInstead}>
            Tap along instead
          </button>
        )}
        {!blocked && (
          <button className="txtbtn" onClick={onTapInstead}>
            Tap along instead
          </button>
        )}
        <button className="txtbtn" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  )
}
