import { configDefaults, defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    // The same '@/…' imports the app uses (tsconfig paths)
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    // Two component tests need @testing-library/react, user-event and a browser-like DOM
    // (jsdom), none of which the web app installs, so they have never run. Left out until
    // those test tools are added after the launch (plan LR6, Oct 23, 2026).
    exclude: [...configDefaults.exclude, 'src/__tests__/command-palette.test.tsx', 'src/__tests__/trending-entities-ui.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    },
  },
})
