import { defineConfig } from 'vitest/config'
import { SERVER_TESTS } from './vitest.config'

// The tests that need a running API server with seeded data (see vitest.config.ts):
//   API_URL=http://localhost:3001 pnpm --filter @worldpulse/api test:server
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: SERVER_TESTS,
  },
})
