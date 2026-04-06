'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandItem {
  label: string
  href: string
}

interface CommandPaletteContextValue {
  isOpen: boolean
  open: () => void
  close: () => void
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
})

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommandPalette(): CommandPaletteContextValue {
  return useContext(CommandPaletteContext)
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const NAV_ITEMS: CommandItem[] = [
  { label: 'Feed', href: '/feed' },
  { label: 'Map', href: '/map' },
  { label: 'Search', href: '/search' },
  { label: 'Alerts', href: '/alerts' },
  { label: 'Finance', href: '/finance' },
  { label: 'Space Weather', href: '/space-weather' },
  { label: 'Cyber Threats', href: '/cyber-threats' },
  { label: 'Sanctions', href: '/sanctions' },
  { label: 'Internet Outages', href: '/internet-outages' },
  { label: 'Undersea Cables', href: '/undersea-cables' },
  { label: 'Governance', href: '/governance' },
  { label: 'Food Security', href: '/food-security' },
  { label: 'Digital Rights', href: '/digital-rights' },
  { label: 'Water Security', href: '/water-security' },
  { label: 'Labor Rights', href: '/labor-rights' },
  { label: 'Countries', href: '/countries' },
  { label: 'Settings', href: '/settings' },
]

const CATEGORY_ITEMS: CommandItem[] = [
  { label: 'Breaking', href: '/feed?category=breaking' },
  { label: 'Conflict', href: '/feed?category=conflict' },
  { label: 'Climate', href: '/feed?category=climate' },
  { label: 'Health', href: '/feed?category=health' },
  { label: 'Markets', href: '/feed?category=markets' },
]

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  // Global ⌘K / Ctrl+K shortcut — lives here so layout.tsx stays a server component
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        open()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  return (
    <CommandPaletteContext.Provider value={{ isOpen, open, close }}>
      {children}
    </CommandPaletteContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Modal UI
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const { isOpen, close } = useCommandPalette()
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset state whenever the palette opens
  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setSelectedIndex(0)
      // autoFocus via ref for better test-library compatibility
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  const filteredNav = NAV_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  )
  const filteredCategories = CATEGORY_ITEMS.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase()),
  )

  const allItems = [...filteredNav, ...filteredCategories]
  const noResults = query !== '' && allItems.length === 0

  // Keep selectedIndex in bounds when results change
  useEffect(() => {
    setSelectedIndex((prev) => (allItems.length === 0 ? 0 : Math.min(prev, allItems.length - 1)))
  }, [allItems.length])

  function navigate(href: string) {
    router.push(href)
    close()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(allItems.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + Math.max(allItems.length, 1)) % Math.max(allItems.length, 1))
    } else if (e.key === 'Enter') {
      if (allItems[selectedIndex]) {
        navigate(allItems[selectedIndex].href)
      }
    } else if (e.key === 'Escape') {
      close()
    }
  }

  if (!isOpen) return null

  return (
    /* Overlay */
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={close}
    >
      {/* Card — stop propagation so clicks inside don't close */}
      <div
        className="relative max-w-xl w-full bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700">
          <svg
            className="w-4 h-4 text-zinc-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search commands, signals, categories..."
            className="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 text-sm outline-none"
            autoFocus
            aria-label="Search commands"
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto py-2" role="listbox">
          {noResults && (
            <p className="px-4 py-6 text-center text-sm text-zinc-500">No results</p>
          )}

          {filteredNav.length > 0 && (
            <Section label="Navigation">
              {filteredNav.map((item) => {
                const globalIdx = allItems.indexOf(item)
                return (
                  <ResultItem
                    key={item.href}
                    item={item}
                    isSelected={globalIdx === selectedIndex}
                    onSelect={() => navigate(item.href)}
                  />
                )
              })}
            </Section>
          )}

          {filteredCategories.length > 0 && (
            <Section label="Categories">
              {filteredCategories.map((item) => {
                const globalIdx = allItems.indexOf(item)
                return (
                  <ResultItem
                    key={item.href}
                    item={item}
                    isSelected={globalIdx === selectedIndex}
                    onSelect={() => navigate(item.href)}
                  />
                )
              })}
            </Section>
          )}
        </div>

        {/* Footer hint */}
        {!noResults && allItems.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-600">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> select</span>
            <span><kbd className="font-mono">ESC</kbd> dismiss</span>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </p>
      {children}
    </div>
  )
}

function ResultItem({
  item,
  isSelected,
  onSelect,
}: {
  item: CommandItem
  isSelected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
        isSelected
          ? 'bg-zinc-700/60 text-zinc-100'
          : 'text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100'
      }`}
    >
      <span className="flex-1">{item.label}</span>
      <span className="text-[11px] text-zinc-500 font-mono">{item.href}</span>
    </button>
  )
}
