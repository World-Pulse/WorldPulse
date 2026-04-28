import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Mock next/link to render as a plain anchor
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) =>
    React.createElement('a', { href, ...props }, children),
}))

import ApiDocsPage from '../app/docs/api/page'

describe('ApiDocsPage', () => {
  it('1. renders without crashing', () => {
    const { container } = render(<ApiDocsPage />)
    expect(container).toBeDefined()
    expect(container.firstChild).toBeTruthy()
  })

  it('2. contains WorldPulse Developer API heading', () => {
    render(<ApiDocsPage />)
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.textContent).toContain('WorldPulse Developer API')
  })

  it('3. contains Authentication section', () => {
    render(<ApiDocsPage />)
    const authSection = document.getElementById('authentication')
    expect(authSection).toBeTruthy()
    expect(authSection!.textContent).toContain('Authentication')
  })

  it('4. contains GET /public/signals endpoint', () => {
    render(<ApiDocsPage />)
    const content = document.body.textContent ?? ''
    expect(content).toContain('GET /public/signals')
  })

  it('5. contains rate limits table with free (60) and pro (300) limits', () => {
    render(<ApiDocsPage />)
    const rateLimitsSection = document.getElementById('rate-limits')
    expect(rateLimitsSection).toBeTruthy()
    const sectionText = rateLimitsSection!.textContent ?? ''
    expect(sectionText).toContain('60')
    expect(sectionText).toContain('300')
  })

  it('6. contains code examples for cURL, TypeScript, and Python', () => {
    render(<ApiDocsPage />)
    const pageText = document.body.textContent ?? ''
    expect(pageText).toContain('cURL')
    expect(pageText).toContain('TypeScript')
    expect(pageText).toContain('Python')
  })

  it('7. contains Webhooks section', () => {
    render(<ApiDocsPage />)
    const webhooksSection = document.getElementById('webhooks')
    expect(webhooksSection).toBeTruthy()
    expect(webhooksSection!.textContent).toContain('Webhooks')
  })

  it('8. contains WebSocket section', () => {
    render(<ApiDocsPage />)
    const wsSection = document.getElementById('websocket')
    expect(wsSection).toBeTruthy()
    const sectionText = wsSection!.textContent ?? ''
    expect(sectionText).toContain('WebSocket')
    expect(sectionText).toContain('wss://api.worldpulse.io/ws')
  })

  it('9. contains Get API Key link pointing to /settings', () => {
    render(<ApiDocsPage />)
    const links = screen.getAllByRole('link', { name: /get api key/i })
    expect(links.length).toBeGreaterThan(0)
    links.forEach((link) => {
      expect(link.getAttribute('href')).toBe('/settings')
    })
  })

  it('10. copy button exists on code blocks', () => {
    render(<ApiDocsPage />)
    // Copy buttons are rendered with aria-label="Copy code to clipboard"
    const copyButtons = screen.getAllByLabelText('Copy code to clipboard')
    expect(copyButtons.length).toBeGreaterThan(0)
  })
})
