import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/** A song the user has counted before, with the tempo and "1" they settled on. */
export interface SavedSong {
  id: string
  name: string
  /** 'file' songs keep their audio; 'tap' songs play elsewhere, so only the tempo is kept. */
  kind: 'file' | 'tap'
  bpm: number
  offsetMs: number
  /** Song time of a 1. Only meaningful for files — a tapped song has no fixed start. */
  anchor: number | null
  updatedAt: number
}

/** Oldest songs (and their audio) are dropped past this. */
export const MAX_SONGS = 30

interface LibrarySchema extends DBSchema {
  songs: { key: string; value: SavedSong; indexes: { byUpdated: number } }
  /** Kept apart from `songs` so listing the library never loads megabytes of audio. */
  audio: { key: string; value: Blob }
}

let db: Promise<IDBPDatabase<LibrarySchema>> | null = null

function open() {
  db ??= openDB<LibrarySchema>('count-me-in', 1, {
    upgrade(d) {
      d.createObjectStore('songs', { keyPath: 'id' }).createIndex('byUpdated', 'updatedAt')
      d.createObjectStore('audio')
    },
  })
  return db
}

/** Stable id for a file, so loading the same file again finds its saved settings. */
export const fileSongId = (file: { name: string; size: number }) => `f:${file.name}:${file.size}`

export async function listSongs(): Promise<SavedSong[]> {
  const songs = await (await open()).getAllFromIndex('songs', 'byUpdated')
  return songs.reverse()
}

export async function getSong(id: string): Promise<SavedSong | undefined> {
  return (await open()).get('songs', id)
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  return (await open()).get('audio', id)
}

/** Saves a song's settings, plus its audio the first time round. */
export async function saveSong(song: Omit<SavedSong, 'updatedAt'>, audio?: Blob): Promise<void> {
  const d = await open()
  const tx = d.transaction(['songs', 'audio'], 'readwrite')
  await tx.objectStore('songs').put({ ...song, updatedAt: Date.now() })
  if (audio) await tx.objectStore('audio').put(audio, song.id)

  // keep the newest MAX_SONGS
  const all = await tx.objectStore('songs').index('byUpdated').getAllKeys()
  for (const id of all.slice(0, Math.max(0, all.length - MAX_SONGS))) {
    await tx.objectStore('songs').delete(id)
    await tx.objectStore('audio').delete(id)
  }
  await tx.done
}

export async function deleteSong(id: string): Promise<void> {
  const d = await open()
  const tx = d.transaction(['songs', 'audio'], 'readwrite')
  await Promise.all([tx.objectStore('songs').delete(id), tx.objectStore('audio').delete(id), tx.done])
}

/** Asks the browser not to evict saved audio when space runs low. Best effort. */
export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => {})
}

/** For tests: forget the open connection so each test can start from a fresh database. */
export async function _resetForTests(): Promise<void> {
  if (db) (await db).close()
  db = null
}
