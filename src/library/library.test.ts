// @vitest-environment node
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SONGS, _resetForTests, deleteSong, fileSongId, getAudio, getSong, listSongs, saveSong, type SavedSong } from './library'

const song = (id: string, extra: Partial<SavedSong> = {}): Omit<SavedSong, 'updatedAt'> => ({
  id,
  name: id,
  kind: 'file',
  bpm: 92,
  offsetMs: 0,
  anchor: 0.5,
  ...extra,
})

beforeEach(async () => {
  await _resetForTests()
  globalThis.indexedDB = new IDBFactory()
  vi.useFakeTimers({ toFake: ['Date'] })
})

describe('library', () => {
  it('saves a song with its audio and gets both back', async () => {
    await saveSong(song('a'), new Blob(['beat'], { type: 'audio/mpeg' }))
    expect(await getSong('a')).toMatchObject({ name: 'a', bpm: 92, anchor: 0.5 })
    expect(await (await getAudio('a'))?.text()).toBe('beat')
  })

  it('updates settings without touching the stored audio', async () => {
    await saveSong(song('a'), new Blob(['beat']))
    await saveSong(song('a', { bpm: 100, name: 'class song' }))
    expect(await getSong('a')).toMatchObject({ bpm: 100, name: 'class song' })
    expect(await (await getAudio('a'))?.text()).toBe('beat')
  })

  it('lists the most recently used first', async () => {
    for (const [i, id] of ['a', 'b', 'c'].entries()) {
      vi.setSystemTime(1000 + i)
      await saveSong(song(id))
    }
    vi.setSystemTime(2000)
    await saveSong(song('a'))
    expect((await listSongs()).map((s) => s.id)).toEqual(['a', 'c', 'b'])
  })

  it(`keeps only the newest ${MAX_SONGS}, audio included`, async () => {
    for (let i = 0; i <= MAX_SONGS; i++) {
      vi.setSystemTime(1000 + i)
      await saveSong(song(`s${i}`), new Blob([String(i)]))
    }
    const ids = (await listSongs()).map((s) => s.id)
    expect(ids).toHaveLength(MAX_SONGS)
    expect(ids).not.toContain('s0')
    expect(await getAudio('s0')).toBeUndefined()
  })

  it('deletes a song and its audio', async () => {
    await saveSong(song('a'), new Blob(['beat']))
    await deleteSong('a')
    expect(await listSongs()).toEqual([])
    expect(await getAudio('a')).toBeUndefined()
  })

  it('recognises the same file when it is loaded again', () => {
    expect(fileSongId({ name: 'track.mp3', size: 123 })).toBe(fileSongId({ name: 'track.mp3', size: 123 }))
    expect(fileSongId({ name: 'track.mp3', size: 123 })).not.toBe(fileSongId({ name: 'track.mp3', size: 124 }))
  })
})
