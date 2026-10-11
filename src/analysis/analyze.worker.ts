/// <reference lib="webworker" />
import { analyze } from './analyze'

export interface AnalyzeRequest {
  samples: Float32Array
  sampleRate: number
}

// Analysing a whole song takes long enough to freeze the page, so it runs here.
self.onmessage = (e: MessageEvent<AnalyzeRequest>) => {
  const result = analyze(e.data.samples, e.data.sampleRate)
  const transfer = [result.envelope.buffer as ArrayBuffer]
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(result, transfer)
}
