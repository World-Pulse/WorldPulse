import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock next/navigation
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import {
  CommandPaletteProvider,
  CommandPalette,
  useCommandPalette,
  CommandPaletteContext,
} from '../components/CommandPalette'

function renderPalette(isOpen = true) {
  const openFn = vi.fn()
  const closeFn = vi.fn()
  return render(
    <CommandPaletteContext.Provider value={{ isOpen, open: openFn, close: closeFn }}>
      <CommandPalette />
    </CommandPaletteContext.Provider>,
  )
}

// Helper: render provider + palette and open it via ⌘K
function renderWithProvider() {
  return render(
    <CommandPaletteProvider>
      <CommandPalette />
    </CommandPaletteProvider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommandPalette', () => {
  beforeEach(() => {
    mockPush.mockReset()
  })

  it('1. renders nothing when isOpen is false', () => {
    renderPalette(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('2. renders the dialog when isOpen is true', () => {
    renderPalette(true)
    expect(screen.getByRole('dialog')).toBeDefined()
  })

  it('3. renders search input with correct placeholder', () => {
    renderPalette(true)
    const input = screen.getByPlaceholderText('Search commands, signals, categories...')
    expect(input).toBeDefined()
  })

  it('4. shows navigation items by default (Feed visible)', () => {
    renderPalette(true)
    expect(screen.getByText('Feed')).toBeDefined()
  })

  it('5. shows category items by default (Breaking visible)', () => {
    renderPalette(true)
    expect(screen.getByText('Breaking')).toBeDefined()
  })

  it('6. filters results by query — only matching items shown', async () => {
    const user = userEvent.setup()
    renderPalette(true)
    const input = screen.getByPlaceholderText('Search commands, signals, categories...')
    await user.type(input, 'map')
    expect(screen.getByText('Map')).toBeDefined()
    expect(screen.queryByText('Feed')).toBeNull()
  })

  it('7. shows "No results" when query matches nothing', async () => {
    const user = userEvent.setup()
    renderPalette(true)
    const input = screen.getByPlaceholderText('Search commands, signals, categories...')
    await user.type(input, 'xyzzy123nonexistent')
    expect(screen.getByText('No results')).toBeDefined()
  })

  it('8. pressing Escape calls close()', () => {
    const closeFn = vi.fn()
    render(
      <CommandPaletteContext.Provider value={{ isOpen: true, open: vi.fn(), close: closeFn }}>
        <CommandPalette />
      </CommandPaletteContext.Provider>,
    )
    const input = screen.getByPlaceholderText('Search commands, signals, categories...')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalledOnce()
  })

  it('9. pressing Enter on selected item calls router.push and close()', () => {
    const closeFn = vi.fn()
    render(
      <CommandPaletteContext.Provider value={{ isOpen: true, open: vi.fn(), close: closeFn }}>
        <CommandPalette />
      </CommandPaletteContext.Provider>,
    )
    const input = screen.getByPlaceholderText('Search commands, signals, categories...')
    // Default selectedIndex = 0 → first nav item = Feed → /feed
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockPush).toHaveBeenCalledWith('/feed')
    expect(closeFn).toHaveBeenCalledOnce()
  })

  it('10. clicking the overlay calls close()', () => {
    const closeFn = vi.fn()
    render(
      <CommandPaletteContext.Provider value={{ isOpen: true, open: vi.fn(), close: closeFn }}>
        <CommandPalette />
      </CommandPaletteContext.Provider>,
    )
    const dialog = screen.getByRole('dialog')
    fireEvent.click(dialog)
    expect(closeFn).toHaveBeenCalledOnce()
  })
})

describe('CommandPaletteProvider — global ⌘K shortcut', () => {
  it('opens the palette when Ctrl+K is pressed', async () => {
    renderWithProvider()
    expect(screen.queryByRole('dialog')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    })
    expect(screen.getByRole('dialog')).toBeDefined()
  })
})
