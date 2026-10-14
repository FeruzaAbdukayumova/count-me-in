/** One drum hit found in the song. */
export interface Hit {
  /** Seconds from the start of the song. */
  t: number
  /** Loudness relative to the other hits in the same lane, 0.3–1. */
  v: number
  /** Analysis frame the hit was found in. */
  f: number
}

/** The three lanes the hits are sorted into. */
export const LANES = ['BOOM', 'CLAP', 'tick'] as const

export interface Analysis {
  bpm: number
  /** Seconds from the start of the song to the first "1". */
  anchor: number
  /**
   * How clearly the chosen 1 beats the runner-up: the bass swell on it divided by the next
   * best. Near 1 means the drums sound the same on several counts and the 1 is a guess.
   */
  downbeatMargin: number
  /**
   * Whether the audio was long enough to check the tempo against a whole repeating 8. Without
   * that check, triplet hi-hats can pass for a different tempo.
   */
  tempoChecked: boolean
  /** Loudness outline of the whole song, normalised to 0–1, for the overview strip. */
  envelope: Float32Array
  /** Hits per lane: [booms, claps, ticks], each sorted by time. */
  hits: [Hit[], Hit[], Hit[]]
  /** A plain-language sentence about where the drums land, or '' if it isn't sure. */
  evidence: string
}
