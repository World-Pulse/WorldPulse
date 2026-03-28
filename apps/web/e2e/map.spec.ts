import { test, expect } from '@playwright/test'

test.describe('Map page', () => {
  test('loads and renders map container', async ({ page }) => {
    await page.goto('/map')
    await expect(page).toHaveTitle(/WorldPulse/)

    // MapLibre GL renders into a canvas or a div with maplibregl class
    const mapContainer = page.locator('.maplibregl-map, [data-testid="map"], canvas').first()
    await expect(mapContainer).toBeVisible({ timeout: 15_000 })
  })

  test('page returns 200 status', async ({ page }) => {
    const response = await page.goto('/map')
    expect(response?.status()).toBe(200)
  })

  test('map page has no broken critical layout', async ({ page }) => {
    await page.goto('/map')
    // Ensure there is no full-page error boundary message
    const errorText = page.getByText(/something went wrong/i)
    await expect(errorText).not.toBeVisible()
  })
})
