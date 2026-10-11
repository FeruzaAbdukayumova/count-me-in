import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts automatically when test globals are on; they're off here.
afterEach(cleanup)
