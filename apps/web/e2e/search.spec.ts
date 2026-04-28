import { test, expect } from '@playwright/test'

test.describe('Search page', () => {
  test('loads and shows search input', async ({ page }) => {
    await page.goto('/search')
    await expect(page).toHaveTitle(/WorldPulse/)

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[name="q"]').first()
    await expect(searchInput).toBeVisible({ timeout: 10_000 })
  })

  test('returns 200 status', async ({ page }) => {
    const response = await page.goto('/search')
    expect(response?.status()).toBe(200)
  })

  test('shows results after entering a query', async ({ page }) => {
    await page.goto('/search')

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[name="q"]').first()
    await searchInput.fill('conflict')
    await page.keyboard.press('Enter')

    // After submitting, the URL should contain the query param
    await expect(page).toHaveURL(/[?&]q=conflict/)
  })

  test('search with query param pre-fills input', async ({ page }) => {
    await page.goto('/search?q=earthquake')

    const searchInput = page.locator('input[type="search"], input[placeholder*="search" i], input[name="q"]').first()
    await expect(searchInput).toHaveValue('earthquake')
  })
})
