import { analyze, mixToMono } from './analyze'
import type { AnalyzeRequest } from './analyze.worker'
import type { Analysis } from './types'

export class SongLoadError extends Error {}

/** Decodes an audio file and works out its beat, off the main thread where possible. */
export async function loadSong(ctx: AudioContext, file: Blob): Promise<{ buffer: AudioBuffer; analysis: Analysis }> {
  let buffer: AudioBuffer
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer())
  } catch {
    throw new SongLoadError("That file wouldn't open. An mp3, m4a or wav works best.")
  }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i))
  // copy, so transferring the samples to the worker doesn't empty the buffer we play from
  const samples = Float32Array.from(mixToMono(channels))
  return { buffer, analysis: await analyzeOffThread(samples, buffer.sampleRate) }
}

function analyzeOffThread(samples: Float32Array, sampleRate: number): Promise<Analysis> {
  if (typeof Worker === 'undefined') return Promise.resolve(analyze(samples, sampleRate))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' })
    const done = () => worker.terminate()
    worker.onmessage = (e: MessageEvent<Analysis>) => {
      done()
      resolve(e.data)
    }
    worker.onerror = (e) => {
      done()
      reject(new SongLoadError(e.message || "Couldn't find the beat in that song."))
    }
    const msg: AnalyzeRequest = { samples, sampleRate }
    worker.postMessage(msg, [samples.buffer])
  })
}
