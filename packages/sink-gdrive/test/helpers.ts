import { noopLogger } from '@ksef-export/shared'
import type { Logger } from '@ksef-export/shared'

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
