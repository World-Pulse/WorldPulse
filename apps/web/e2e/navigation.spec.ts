import { test, expect } from '@playwright/test'

const ROUTES = [
  { path: '/',          name: 'Home' },
  { path: '/map',       name: 'Map' },
  { path: '/search',    name: 'Search' },
  { path: '/explore',   name: 'Explore' },
] as const

test.describe('Navigation', () => {
  test('all primary routes load without server errors', async ({ page }) => {
    for (const route of ROUTES) {
      const response = await page.goto(route.path)
      expect(response?.status(), `${route.name} (${route.path}) should return 2xx`).toBeLessThan(400)
    }
  })

  test('navigating between pages preserves layout', async ({ page }) => {
    await page.goto('/')
    const nav = page.locator('nav').first()
    await expect(nav).toBeVisible()

    // Navigate to map
    await page.goto('/map')
    await expect(nav).toBeVisible()

    // Navigate to search
    await page.goto('/search')
    await expect(nav).toBeVisible()
  })

  test('404 page is shown for unknown routes', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-xyz')
    // Next.js returns 404 for unknown routes
    expect(response?.status()).toBe(404)
  })

  test('no console errors on homepage', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await page.goto('/')
    // Filter out known benign third-party errors
    const critical = errors.filter(e => !e.includes('net::ERR') && !e.includes('favicon'))
    expect(critical).toHaveLength(0)
  })
})
