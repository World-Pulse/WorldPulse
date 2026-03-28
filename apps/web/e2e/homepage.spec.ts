import { test, expect } from '@playwright/test'

test.describe('Homepage', () => {
  test('loads and shows signal feed', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/WorldPulse/)
    // Signal feed container should be present
    const feed = page.locator('[data-testid="feed"], main, [role="feed"], article').first()
    await expect(feed).toBeVisible({ timeout: 10_000 })
  })

  test('page has expected navigation elements', async ({ page }) => {
    await page.goto('/')
    // Top nav should be present
    const nav = page.locator('nav').first()
    await expect(nav).toBeVisible()
  })

  test('page returns 200 status', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
  })
})
