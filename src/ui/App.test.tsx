import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { CountEngine } from '../engine/CountEngine'
import { _resetForTests } from '../library/library'
import type { ListenState, ListenStatus, Listener } from '../listen/Listener'
import { App } from './App'

/** Just enough of an AudioContext to drive the engine; `currentTime` is set by the test. */
class FakeAudioContext {
  static last: FakeAudioContext
  currentTime = 0
  state = 'running'
  destination = {}
  constructor() {
    FakeAudioContext.last = this
  }
  createGain() {
    const ramp = () => {}
    return {
      gain: { value: 1, setValueAtTime: ramp, linearRampToValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
      connect: (n: unknown) => n,
    }
  }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start() {}, stop() {} }
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

beforeEach(async () => {
  await _resetForTests()
  globalThis.indexedDB = new IDBFactory()
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext
})

async function tapAlong(user: ReturnType<typeof userEvent.setup>, everySeconds: number) {
  for (let i = 0; i < 4; i++) {
    FakeAudioContext.last.currentTime = 10 + i * everySeconds
    await user.click(screen.getByRole('button', { name: 'Tap' }))
  }
}

describe('tapping along to a song playing elsewhere', () => {
  it('works out the tempo from four taps and starts counting', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)

    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    expect(screen.getByRole('progressbar', { name: 'Taps' })).toHaveAttribute('aria-valuenow', '0')
    await tapAlong(user, 0.6)

    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.getByText(/press the button below once/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('100')).toBeInTheDocument()
  })

  it('asks for more taps when the audio clock is stuck, instead of freezing', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Tap' }))

    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Taps' })).toHaveAttribute('aria-valuenow', '0')
  })

  it('remembers a named song and brings its tempo back', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)

    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    await tapAlong(user, 0.5)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.type(screen.getByRole('textbox'), 'Class warm-up')
    await user.click(screen.getByRole('button', { name: 'Use a different song' }))

    const song = await screen.findByRole('button', { name: 'Class warm-up' }, { timeout: 2000 })
    expect(screen.getByText('120 bpm · tapped')).toBeInTheDocument()

    await user.click(song)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('120')).toBeInTheDocument()
  })

  it('keeps each song’s tempo with that song when switching quickly', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)

    for (const [name, gap] of [['Warm-up', 0.6], ['Routine', 0.5]] as const) {
      await user.click(screen.getByRole('button', { name: /tap along instead/i }))
      await tapAlong(user, gap)
      await user.click(screen.getByRole('button', { name: 'Settings' }))
      await user.type(screen.getByRole('textbox'), name)
      await user.click(screen.getByRole('button', { name: 'Use a different song' }))
    }

    await screen.findByRole('button', { name: 'Routine' }, { timeout: 2000 })
    await waitFor(() => {
      const rows = screen.getAllByRole('button', { name: /^(Warm-up|Routine)$/ }).map((b) => b.parentElement!.textContent)
      expect(rows).toEqual(['Routine120 bpm · tapped×', 'Warm-up100 bpm · tapped×'])
    })
  })

  it('forgets a song for good', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    await tapAlong(user, 0.6)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.type(screen.getByRole('textbox'), 'Old song')
    await user.click(screen.getByRole('button', { name: 'Use a different song' }))

    await user.click(await screen.findByRole('button', { name: 'Forget Old song' }, { timeout: 2000 }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Old song' })).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 700))
    expect(screen.queryByRole('button', { name: 'Old song' })).not.toBeInTheDocument()
  })

  it('does not save a tapped song nobody has named', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)

    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    await tapAlong(user, 0.6)
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Use a different song' }))

    await new Promise((r) => setTimeout(r, 700))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Your songs' })).not.toBeInTheDocument())
  })
})

describe('settings', () => {
  it('halves and doubles the tempo', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    await tapAlong(user, 0.6)
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    await user.click(screen.getByRole('button', { name: 'Slower' }))
    expect(screen.getByText('50')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Faster' }))
    await user.click(screen.getByRole('button', { name: 'Faster' }))
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('nudges the count in 10 ms steps', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    await tapAlong(user, 0.6)
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    await user.click(screen.getByRole('button', { name: /slightly early or late: more/i }))
    await user.click(screen.getByRole('button', { name: /slightly early or late: more/i }))
    expect(screen.getByText('+20 ms')).toBeInTheDocument()
  })
})

/** Stands in for the microphone: the test says when the beat has been found. */
class FakeListener {
  state: ListenState = { status: 'off', heard: 0, claps: null, hearing: false, doubt: false }
  findAgainCalls = 0
  fns = new Set<() => void>()
  anchors: number[] = []
  engine: CountEngine
  constructor(engine: CountEngine) {
    this.engine = engine
  }
  subscribe = (fn: () => void) => {
    this.fns.add(fn)
    return () => void this.fns.delete(fn)
  }
  getState = () => this.state
  emit(status: ListenStatus, extra: Partial<ListenState> = {}) {
    this.state = { ...this.state, status, hearing: status === 'listening' || status === 'locked', ...extra }
    this.fns.forEach((fn) => fn())
  }
  async start() {
    this.engine.audio()
    this.engine.useListenMode()
    this.emit('quiet')
  }
  stop() {
    this.emit('off')
  }
  placeOne(anchor: number) {
    this.anchors.push(anchor)
  }
  findAgain() {
    this.findAgainCalls++
    this.emit('quiet')
  }
}

describe('listening through the microphone', () => {
  it('says so when the browser has no microphone, and offers tapping instead', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)
    await user.click(screen.getByRole('button', { name: /listen to my music/i }))
    expect(await screen.findByText(/can't listen to the microphone/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
  })

  it('waits for music, then counts once the beat is found', async () => {
    const user = userEvent.setup()
    const engine = new CountEngine()
    const listener = new FakeListener(engine)
    render(<App engine={engine} listener={listener as unknown as Listener} />)

    await user.click(screen.getByRole('button', { name: /listen to my music/i }))
    expect(screen.getByText(/out loud/i)).toBeInTheDocument()
    act(() => listener.emit('listening', { heard: 4 }))
    expect(screen.getByText(/finding the/i)).toBeInTheDocument()

    act(() => {
      engine.follow(96, 3)
      listener.emit('locked')
    })
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument()
    expect(engine.getState()).toMatchObject({ mode: 'listen', running: true, grid: { bpm: 96, anchor: 3 } })
    // the click is off so the microphone doesn't hear it as a beat
    expect(engine.getState().options.click).toBe(false)

    FakeAudioContext.last.currentTime = 20
    await user.click(screen.getByRole('button', { name: /tap on the 1/i }))
    expect(listener.anchors).toEqual([20])

    // the music stops: the count carries on, and says so
    act(() => listener.emit('locked', { hearing: false }))
    expect(screen.getByText(/can't hear the music/i)).toBeInTheDocument()
    expect(engine.getState().running).toBe(true)

    // a different song for a while: a note, but no jump
    act(() => listener.emit('locked', { doubt: true }))
    expect(screen.getByText(/new song/i)).toBeInTheDocument()
    expect(engine.getState()).toMatchObject({ running: true, grid: { bpm: 96 } })
    await user.click(screen.getByRole('button', { name: /find the beat again/i }))
    expect(listener.findAgainCalls).toBe(1)
    expect(engine.getState().running).toBe(false)
    expect(screen.getByText(/out loud/i)).toBeInTheDocument()
    act(() => {
      engine.follow(120, 30)
      listener.emit('locked')
    })
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Stop listening' }))
    expect(screen.getByRole('button', { name: /listen to my music/i })).toBeInTheDocument()
    expect(engine.getState().running).toBe(false)
  })

  it('gives the click back after listening', async () => {
    const user = userEvent.setup()
    const engine = new CountEngine()
    const listener = new FakeListener(engine)
    render(<App engine={engine} listener={listener as unknown as Listener} />)
    await user.click(screen.getByRole('button', { name: /listen to my music/i }))
    await user.click(screen.getByRole('button', { name: /tap along instead/i }))
    expect(engine.getState().options.click).toBe(true)
  })

  it('teaches the clap: waits for the beat and a clear clap, then shows where it lands', async () => {
    const user = userEvent.setup()
    const engine = new CountEngine()
    const listener = new FakeListener(engine)
    render(<App engine={engine} listener={listener as unknown as Listener} />)

    await user.click(screen.getByRole('button', { name: /learn to hear the count/i }))
    expect(screen.getByText(/out loud/i)).toBeInTheDocument()
    act(() => {
      engine.follow(112, 3)
      listener.emit('locked')
    })
    expect(screen.getByText(/listening for the clap/i)).toBeInTheDocument()
    act(() => listener.emit('locked', { claps: [2, 6] }))
    expect(await screen.findByText(/the clap lands on/i)).toHaveTextContent('In this song the clap lands on 3 and 7.')

    await user.click(screen.getByRole('button', { name: /stop the lesson/i }))
    expect(screen.getByRole('button', { name: /listen to my music/i })).toBeInTheDocument()
    expect(engine.getState().running).toBe(false)
  })
})
