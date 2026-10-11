import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it } from 'vitest'
import { CountEngine } from '../engine/CountEngine'
import { _resetForTests } from '../library/library'
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

    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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
    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Tap' }))

    expect(screen.getByRole('button', { name: 'Tap' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Taps' })).toHaveAttribute('aria-valuenow', '0')
  })

  it('remembers a named song and brings its tempo back', async () => {
    const user = userEvent.setup()
    render(<App engine={new CountEngine()} />)

    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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
      await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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
    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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

    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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
    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
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
    await user.click(screen.getByRole('button', { name: /playing somewhere else/i }))
    await tapAlong(user, 0.6)
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    await user.click(screen.getByRole('button', { name: /slightly early or late: more/i }))
    await user.click(screen.getByRole('button', { name: /slightly early or late: more/i }))
    expect(screen.getByText('+20 ms')).toBeInTheDocument()
  })
})
