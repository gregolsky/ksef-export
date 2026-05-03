import { noopLogger } from '@ksef2gdrive/shared'
import type { Logger } from '@ksef2gdrive/shared'

export { noopLogger }
export type { Logger }

export function makeFakeDrive() {
  return {
    files: {
      list: vi.fn(),
      create: vi.fn(),
    },
  }
}

// Must import vi at test level; re-exported here for convenience
export { vi } from 'vitest'
