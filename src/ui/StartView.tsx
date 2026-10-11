import { useRef } from 'react'
import type { SavedSong } from '../library/library'

interface Props {
  status: string
  songs: SavedSong[]
  onFile: (file: File) => void
  onTapMode: () => void
  onOpenSong: (song: SavedSong) => void
  onDeleteSong: (song: SavedSong) => void
}

export function StartView({ status, songs, onFile, onTapMode, onOpenSong, onDeleteSong }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="view">
      <div className="lede">
        <h1>It counts the music out loud, so you can hear where the 1 is.</h1>
        <p>Two ways to start. Neither one needs you to know anything about music.</p>
      </div>

      <div className="choices">
        <button className="choice" onClick={() => fileRef.current?.click()}>
          <b>Use a song saved on this device</b>
          <span>Pick an audio file and I work the counting out by myself. Nothing to set up. This is the accurate one.</span>
        </button>
        <button className="choice" onClick={onTapMode}>
          <b>My song is playing somewhere else</b>
          <span>
            Spotify on your phone, a video, the speakers in class. You tap along four times and I take over from there.
          </span>
        </button>
      </div>

      <p className="aside">
        Spotify doesn't let a website listen to its music, so there's no link to paste — tapping along is the way in.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        data-testid="file-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <div className="status" role="status">
        {status}
      </div>

      {songs.length > 0 && (
        <section className="library" aria-label="Your songs">
          <div className="grouplab">Your songs</div>
          {songs.map((s) => (
            <div className="savedrow" key={s.id}>
              <button className="nm" onClick={() => onOpenSong(s)}>
                {s.name}
              </button>
              <span className="meta">
                {Math.round(s.bpm)} bpm{s.kind === 'tap' ? ' · tapped' : ''}
              </span>
              <button className="x" aria-label={`Forget ${s.name}`} onClick={() => onDeleteSong(s)}>
                ×
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
