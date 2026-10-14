/// <reference lib="webworker" />
import { estimateWindow } from './estimate'
import type { Estimate } from './follow'

export interface ListenRequest {
  samples: Float32Array
  sampleRate: number
  startTime: number
}

export type ListenResponse = Estimate | null

// Each window takes a few hundred milliseconds to analyse; here it can't stutter the count.
self.onmessage = (e: MessageEvent<ListenRequest>) => {
  const { samples, sampleRate, startTime } = e.data
  const result: ListenResponse = estimateWindow(samples, sampleRate, startTime)
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(result)
}
