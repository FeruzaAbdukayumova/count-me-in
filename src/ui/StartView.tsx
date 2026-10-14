import { useRef } from 'react'
import type { SavedSong } from '../library/library'

interface Props {
  status: string
  songs: SavedSong[]
  onFile: (file: File) => void
  onTapMode: () => void
  onListen: () => void
  onLesson: () => void
  onOpenSong: (song: SavedSong) => void
  onDeleteSong: (song: SavedSong) => void
}

export function StartView({ status, songs, onFile, onTapMode, onListen, onLesson, onOpenSong, onDeleteSong }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <div className="view">
      <div className="lede">
        <h1>It counts the music out loud, so you can hear where the 1 is.</h1>
        <p>You don't need to know anything about music.</p>
      </div>

      <div className="choices">
        <button className="choice main" onClick={onListen}>
          <b>Listen to my music</b>
          <span>Play a song out loud, from Spotify, YouTube or the speaker in class. I'll listen and count along.</span>
        </button>
      </div>

      <div className="others">
        <button className="txtbtn" onClick={onLesson}>
          Learn to hear the count
        </button>
        <button className="txtbtn" onClick={onTapMode}>
          Tap along instead
        </button>
        <button className="txtbtn" onClick={() => fileRef.current?.click()}>
          Use a song file
        </button>
      </div>
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
