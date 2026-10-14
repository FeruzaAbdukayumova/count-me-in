import type { Focus } from '../engine/grid'
import { useEngine, useEngineState } from './hooks'

interface Props {
  name: string
  showDrums: boolean
  showWhole: boolean
  onName: (name: string) => void
  onShowDrums: (on: boolean) => void
  onShowWhole: (on: boolean) => void
  onFocusOne: () => void
  onRetap: () => void
  onNewSong: () => void
  onClose: () => void
}

const FOCUS: { value: Focus; label: string }[] = [
  { value: 'all', label: 'All eight' },
  { value: 'onefive', label: '1 and 5' },
  { value: 'one', label: 'Only 1' },
]

export function SettingsSheet(p: Props) {
  const engine = useEngine()
  const { options, grid, mode } = useEngineState()
  const isFile = mode === 'file'
  // while listening, the microphone sets the tempo and this song isn't kept, so those controls go
  const isListen = mode === 'listen'

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="sheetin">
        <div className="sheethead">
          <h2 id="settings-title">Settings</h2>
          <button className="txtbtn" onClick={p.onClose}>
            Done
          </button>
        </div>

        <Toggle
          label="Say the numbers out loud"
          note="A voice counts along. Goes quiet on fast songs."
          checked={options.voice}
          onChange={(v) => engine.setOption('voice', v)}
        />
        <Toggle
          label="Tick on every count"
          note={isListen ? 'A short click, louder on the 1. Off while listening: the microphone hears it too.' : 'A short click, louder on the 1.'}
          checked={options.click}
          onChange={(v) => engine.setOption('click', v)}
        />
        <Toggle
          label="Count me in first"
          note="Ticks 5-6-7-8 before the music starts, the way a teacher does."
          checked={options.countIn}
          onChange={(v) => engine.setOption('countIn', v)}
        />

        <div className="grouplab">Make it easier</div>
        <div className="opt">
          <span className="lbl">
            <span>Which numbers to light up</span>
            <em>Start with only the 1 until finding it feels automatic.</em>
          </span>
          <div className="seg" role="radiogroup" aria-label="Which numbers to light up">
            {FOCUS.map((f) => (
              <button
                key={f.value}
                role="radio"
                aria-checked={options.focus === f.value}
                className={options.focus === f.value ? 'on' : ''}
                onClick={() => {
                  engine.setOption('focus', f.value)
                  if (f.value === 'one') p.onFocusOne()
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {isFile && (
          <div className="opt">
            <span className="lbl">
              <span>Slow the song down</span>
              <em>
                Same counting, less panic.{' '}
                <b>{options.rate === 1 ? 'normal speed' : Math.round(options.rate * 100) + '% speed'}</b>
              </em>
            </span>
            <input
              className="slider"
              type="range"
              min={50}
              max={100}
              step={5}
              aria-label="Playback speed"
              value={Math.round(options.rate * 100)}
              onChange={(e) => engine.setOption('rate', Number(e.target.value) / 100)}
            />
          </div>
        )}

        {isFile && (
          <>
            <div className="grouplab">Show me more</div>
            <Toggle
              label="Show what it's counting"
              note="The drum hits sliding towards the line. Turn off for just the numbers."
              checked={p.showDrums}
              onChange={p.onShowDrums}
            />
            <Toggle
              label="Show the whole song"
              note="A strip of the entire track. Tap anywhere to jump there."
              checked={p.showWhole}
              onChange={p.onShowWhole}
            />
          </>
        )}

        <div className="grouplab">If the counting doesn't match</div>
        <p className="plain">
          First try <b>It's off — tap on the 1</b> on the main screen: tap once, when you hear the moment things start
          over. That fixes it nine times out of ten.
        </p>
        <Stepper
          label="Counting is slightly early or late"
          note="Nudge it by a hair."
          value={(grid.offsetMs > 0 ? '+' : '') + grid.offsetMs + ' ms'}
          onDown={() => engine.setOffset(grid.offsetMs - 10)}
          onUp={() => engine.setOffset(grid.offsetMs + 10)}
        />
        {!isListen && (
          <>
        <Stepper
          label="How fast the song is"
          note="Beats per minute. Only change this if the numbers run away from the music."
          value={String(Math.round(grid.bpm))}
          onDown={() => engine.setBpm(grid.bpm - 1)}
          onUp={() => engine.setBpm(grid.bpm + 1)}
        />
        <div className="opt">
          <span className="lbl">
            <span>Counting twice as fast as the music</span>
            <em>Or twice as slow. One tap either way.</em>
          </span>
          <div className="seg">
            <button onClick={() => engine.setBpm(grid.bpm / 2)}>Slower</button>
            <button onClick={() => engine.setBpm(grid.bpm * 2)}>Faster</button>
          </div>
        </div>
        <button className="txtbtn self-start" onClick={p.onRetap}>
          Tap the beat out again
        </button>
          </>
        )}

        {!isListen && (
          <>
        <div className="grouplab">This song</div>
        <label className="opt">
          <span className="lbl">
            <span>Name this song</span>
            <em>
              {isFile
                ? 'It stays in Your songs with its speed, ready to open next time.'
                : 'Give it a name and its speed comes back next time.'}
            </em>
          </span>
          <input
            type="text"
            placeholder="e.g. the one from class"
            autoComplete="off"
            value={p.name}
            onChange={(e) => p.onName(e.target.value)}
          />
        </label>
          </>
        )}

        <div className="grouplab">Start over</div>
        <button className="txtbtn self-start" onClick={p.onNewSong}>
          Use a different song
        </button>

        <div className="grouplab">Keys, if you're on a laptop</div>
        <p className="plain">
          Space starts and stops. <b>T</b> taps. <b>1</b> tells it you're on the 1.
        </p>
      </div>
    </div>
  )
}

function Toggle(p: { label: string; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="opt">
      <span className="lbl">
        <span>{p.label}</span>
        <em>{p.note}</em>
      </span>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.target.checked)} />
    </label>
  )
}

function Stepper(p: { label: string; note: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <div className="opt">
      <span className="lbl">
        <span>{p.label}</span>
        <em>{p.note}</em>
      </span>
      <div className="stepper">
        <button aria-label={`${p.label}: less`} onClick={p.onDown}>
          −
        </button>
        <span className="read" aria-live="polite">
          {p.value}
        </span>
        <button aria-label={`${p.label}: more`} onClick={p.onUp}>
          +
        </button>
      </div>
    </div>
  )
}
