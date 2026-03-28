import { test, expect } from '@playwright/test'

test.describe('Auth flow', () => {
  test('login page renders with form', async ({ page }) => {
    await page.goto('/auth/login')
    await expect(page).toHaveTitle(/WorldPulse/)

    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    const passwordInput = page.locator('input[type="password"], input[name="password"]').first()
    const submitButton = page.locator('button[type="submit"]').first()

    await expect(emailInput).toBeVisible({ timeout: 10_000 })
    await expect(passwordInput).toBeVisible()
    await expect(submitButton).toBeVisible()
  })

  test('login form submits and shows feedback on bad credentials', async ({ page }) => {
    await page.goto('/auth/login')

    await page.fill('input[type="email"], input[name="email"]', 'test@example.com')
    await page.fill('input[type="password"], input[name="password"]', 'wrongpassword')
    await page.click('button[type="submit"]')

    // Should show an error message (invalid credentials) — not a JS crash
    const error = page.locator('[role="alert"], .error, [data-testid="error"]').first()
    await expect(error).toBeVisible({ timeout: 8_000 })
  })

  test('register page renders with form', async ({ page }) => {
    await page.goto('/auth/register')
    await expect(page).toHaveTitle(/WorldPulse/)

    const emailInput = page.locator('input[type="email"], input[name="email"]').first()
    await expect(emailInput).toBeVisible({ timeout: 10_000 })
  })

  test('login page links to register page', async ({ page }) => {
    await page.goto('/auth/login')

    // There should be a link to the register page
    const registerLink = page.locator('a[href*="register"]').first()
    await expect(registerLink).toBeVisible()
    await registerLink.click()
    await expect(page).toHaveURL(/register/)
  })

  test('login page returns 200 status', async ({ page }) => {
    const response = await page.goto('/auth/login')
    expect(response?.status()).toBe(200)
  })
})
