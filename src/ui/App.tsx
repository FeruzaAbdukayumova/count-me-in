import { useCallback, useEffect, useRef, useState } from 'react'
import { SongLoadError, loadSong } from '../analysis/loadSong'
import { CountEngine } from '../engine/CountEngine'
import {
  deleteSong,
  fileSongId,
  getAudio,
  getSong,
  listSongs,
  requestPersistentStorage,
  saveSong,
  type SavedSong,
} from '../library/library'
import { CountView, type HintKey } from './CountView'
import { EngineContext } from './hooks'
import { SettingsSheet } from './SettingsSheet'
import { StartView } from './StartView'
import { TapView } from './TapView'

type View = 'start' | 'tap' | 'count'

/** The song being counted. `id` is null for a tapped song until it gets a name. */
interface Current {
  id: string | null
  name: string
  kind: 'file' | 'tap'
}

const SAVE_DELAY_MS = 500

type SavedSongInput = Parameters<typeof saveSong>[0]

export function App({ engine = defaultEngine() }: { engine?: CountEngine }) {
  const [view, setView] = useState<View>('start')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [hint, setHint] = useState<HintKey>('ready')
  const [status, setStatus] = useState('')
  const [songs, setSongs] = useState<SavedSong[]>([])
  const [current, setCurrent] = useState<Current | null>(null)
  const [showDrums, setShowDrums] = useState(true)
  const [showWhole, setShowWhole] = useState(false)

  const refreshSongs = useCallback(() => {
    listSongs()
      .then(setSongs)
      .catch(() => setSongs([]))
  }, [])
  useEffect(refreshSongs, [refreshSongs])

  // ---------- saving: any change to the tempo, the 1 or the name is saved half a second later ----------
  // What to save is captured when the change happens, not when the timer fires — by then the
  // user may have moved on to another song, and its tempo would be written under the old one.
  const pending = useRef<{ song: SavedSongInput; timer: ReturnType<typeof setTimeout> } | null>(null)
  const writeNow = useCallback(
    (song: SavedSongInput) => {
      saveSong(song)
        .then(refreshSongs)
        .catch(() => {})
    },
    [refreshSongs],
  )
  const flushSave = useCallback(() => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    writeNow(pending.current.song)
    pending.current = null
  }, [writeNow])
  const currentRef = useRef(current)
  useEffect(() => {
    currentRef.current = current
  })
  const scheduleSave = useCallback(() => {
    const c = currentRef.current
    if (!c?.id) return
    const { grid } = engine.getState()
    const song: SavedSongInput = {
      id: c.id,
      name: c.name || 'Untitled',
      kind: c.kind,
      bpm: Math.round(grid.bpm * 10) / 10,
      offsetMs: grid.offsetMs,
      anchor: c.kind === 'file' ? grid.anchor : null,
    }
    // a different song's change is waiting: write it now rather than let this one replace it
    if (pending.current && pending.current.song.id !== song.id) flushSave()
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = {
      song,
      timer: setTimeout(() => {
        pending.current = null
        writeNow(song)
      }, SAVE_DELAY_MS),
    }
  }, [engine, flushSave, writeNow])

  useEffect(() => {
    let grid = engine.getState().grid
    return engine.subscribe(() => {
      const next = engine.getState().grid
      if (next !== grid) {
        grid = next
        scheduleSave()
      }
    })
  }, [engine, scheduleSave])
  useEffect(scheduleSave, [current, scheduleSave])

  /**
   * Makes `song` current *before* the engine's tempo changes, so the tempo change is saved
   * under the new song and not the one being left.
   */
  const switchTo = useCallback(
    (song: Current | null) => {
      flushSave()
      currentRef.current = song
      setCurrent(song)
    },
    [flushSave],
  )
  // leaving the app with a change still waiting
  useEffect(() => {
    window.addEventListener('pagehide', flushSave)
    return () => window.removeEventListener('pagehide', flushSave)
  }, [flushSave])

  // ---------- opening songs ----------
  const openAudio = async (audio: Blob, song: Current & { id: string }, saved?: SavedSong) => {
    const ctx = engine.audio()
    setStatus('Finding the beat…')
    try {
      const { buffer, analysis } = await loadSong(ctx, audio)
      switchTo(song)
      engine.loadFile(buffer, analysis, saved && { bpm: saved.bpm, offsetMs: saved.offsetMs, anchor: saved.anchor ?? undefined })
      setStatus('')
      setShowDrums(true)
      setHint('sounds')
      setView('count')
      engine.start()
      return true
    } catch (e) {
      setStatus(e instanceof SongLoadError ? e.message : "Something went wrong reading that song.")
      return false
    }
  }

  const onFile = async (file: File) => {
    engine.audio()
    setStatus('Reading ' + file.name + '…')
    const id = fileSongId(file)
    const saved = await getSong(id).catch(() => undefined)
    const name = saved?.name ?? file.name.replace(/\.[^.]+$/, '')
    const ok = await openAudio(file, { id, name, kind: 'file' }, saved)
    if (ok && !saved) {
      requestPersistentStorage()
      const { grid } = engine.getState()
      await saveSong({ id, name, kind: 'file', bpm: grid.bpm, offsetMs: grid.offsetMs, anchor: grid.anchor }, file).catch(
        () => setStatus("Counting works, but this song couldn't be saved — the device may be out of space."),
      )
      refreshSongs()
    }
  }

  const onOpenSong = async (song: SavedSong) => {
    engine.audio()
    if (song.kind === 'tap') {
      switchTo({ id: song.id, name: song.name, kind: 'tap' })
      engine.useTapMode({ bpm: song.bpm, offsetMs: song.offsetMs })
      setHint('placeone')
      setView('count')
      return
    }
    const audio = await getAudio(song.id).catch(() => undefined)
    if (!audio) {
      setStatus(`The audio for "${song.name}" is gone from this device. Pick the file again to bring it back.`)
      return
    }
    await openAudio(audio, { id: song.id, name: song.name, kind: 'file' }, song)
  }

  const onDeleteSong = async (song: SavedSong) => {
    // a save still waiting would bring the song straight back
    if (pending.current?.song.id === song.id) {
      clearTimeout(pending.current.timer)
      pending.current = null
    }
    if (currentRef.current?.id === song.id) {
      currentRef.current = { ...currentRef.current, id: null }
      setCurrent(currentRef.current)
    }
    await deleteSong(song.id).catch(() => {})
    refreshSongs()
  }

  // ---------- counting ----------
  const startTapMode = () => {
    engine.audio()
    switchTo({ id: null, name: '', kind: 'tap' })
    engine.useTapMode()
    setView('tap')
  }

  const onTap = useCallback(() => {
    if (engine.tap()) {
      setView('count')
      setHint('placeone')
    }
  }, [engine])

  const onMarkOne = useCallback(() => {
    engine.markOne()
    setHint('fixed')
  }, [engine])

  const onName = (name: string) => {
    setCurrent((c) => {
      if (!c) return c
      const trimmed = name.trimStart()
      // a tapped song has nothing to identify it until it's named
      const id = c.id ?? (trimmed ? 't:' + crypto.randomUUID() : null)
      return { ...c, id, name: trimmed }
    })
  }

  const onRetap = () => {
    setSheetOpen(false)
    const { mode, running } = engine.getState()
    if (mode === 'file' && !running) engine.start()
    engine.resetTaps()
    setView('tap')
  }

  const onNewSong = () => {
    switchTo(null)
    engine.stop()
    setStatus('')
    setSheetOpen(false)
    setView('start')
  }

  // ---------- keys and drag-and-drop ----------
  const onFileRef = useRef(onFile)
  useEffect(() => {
    onFileRef.current = onFile
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = (e.target as HTMLElement).tagName
      if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA' || view === 'start' || sheetOpen) return
      if (e.code === 'Space') {
        e.preventDefault()
        ;(document.activeElement as HTMLElement | null)?.blur()
        if (view === 'tap') onTap()
        else engine.toggle()
      } else if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        onTap()
      } else if (e.key === '1') {
        e.preventDefault()
        onMarkOne()
      }
    }
    const prevent = (e: DragEvent) => e.preventDefault()
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer?.files?.[0]
      if (f && f.type.startsWith('audio/')) void onFileRef.current(f)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', onDrop)
    }
  }, [engine, view, sheetOpen, onTap, onMarkOne])

  return (
    <EngineContext.Provider value={engine}>
      <div className="app">
        <header className="top">
          <div className="logo">
            Count <em>Me</em> In
          </div>
          <div className="song">{current?.name}</div>
          {view !== 'start' && (
            <button className="txtbtn" onClick={() => setSheetOpen(true)}>
              Settings
            </button>
          )}
        </header>

        {view === 'start' && (
          <StartView
            status={status}
            songs={songs}
            onFile={(f) => void onFile(f)}
            onTapMode={startTapMode}
            onOpenSong={(s) => void onOpenSong(s)}
            onDeleteSong={(s) => void onDeleteSong(s)}
          />
        )}
        {view === 'tap' && <TapView onTap={onTap} onBack={() => setView(current?.kind === 'file' ? 'count' : 'start')} />}
        {view === 'count' && (
          <CountView hint={hint} showDrums={showDrums} showWhole={showWhole} onMarkOne={onMarkOne} />
        )}
      </div>

      {sheetOpen && (
        <SettingsSheet
          name={current?.name ?? ''}
          showDrums={showDrums}
          showWhole={showWhole}
          onName={onName}
          onShowDrums={setShowDrums}
          onShowWhole={setShowWhole}
          onFocusOne={() => setHint('onlyone')}
          onRetap={onRetap}
          onNewSong={onNewSong}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </EngineContext.Provider>
  )
}

let shared: CountEngine | null = null
function defaultEngine() {
  return (shared ??= new CountEngine())
}
