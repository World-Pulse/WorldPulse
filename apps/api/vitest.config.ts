import { configDefaults, defineConfig } from 'vitest/config'

// Tests that call a running API server (http://localhost:3001, or API_URL) with seeded
// data: left out of the unit run, run with `pnpm test:server` against a server
// (plan LR6, Oct 23, 2026: 172 of the 283 failing API tests were these)
export const SERVER_TESTS = [
  'src/routes/__tests__/integration.test.ts',
  'src/routes/__tests__/e2e.test.ts',
  'src/__tests__/developer-portal.test.ts',
]

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...SERVER_TESTS],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/db/migrate.ts',
        'src/scripts/**',
      ],
    },
  },
})
