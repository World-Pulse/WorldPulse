'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type ToastVariant = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id:      string
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}

const VARIANT_STYLES: Record<ToastVariant, { border: string; icon: string }> = {
  success: { border: 'border-[rgba(0,230,118,0.5)]  bg-[rgba(0,230,118,0.07)]',  icon: '✓' },
  error:   { border: 'border-[rgba(255,59,92,0.5)]  bg-[rgba(255,59,92,0.07)]',  icon: '✕' },
  info:    { border: 'border-[rgba(0,212,255,0.5)]  bg-[rgba(0,212,255,0.07)]',  icon: 'ℹ' },
  warning: { border: 'border-[rgba(245,166,35,0.5)] bg-[rgba(245,166,35,0.07)]', icon: '⚠' },
}

const VARIANT_TEXT: Record<ToastVariant, string> = {
  success: 'text-wp-green',
  error:   'text-wp-red',
  info:    'text-wp-cyan',
  warning: 'text-wp-amber',
}

function SingleToast({ item, onRemove }: { item: ToastItem; onRemove: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(item.id), 4000)
    return () => clearTimeout(t)
  }, [item.id, onRemove])

  const { border, icon } = VARIANT_STYLES[item.variant]
  const textCls = VARIANT_TEXT[item.variant]

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl text-[13px] font-medium
        animate-fade-in min-w-[260px] max-w-[360px] glass ${border}`}
    >
      <span className={`font-bold text-[14px] shrink-0 mt-px ${textCls}`} aria-hidden="true">
        {icon}
      </span>
      <span className="flex-1 text-wp-text leading-relaxed">{item.message}</span>
      <button
        onClick={() => onRemove(item.id)}
        aria-label="Dismiss"
        className="shrink-0 text-wp-text3 hover:text-wp-text transition-colors text-[18px] leading-none ml-1 -mt-px"
      >
        ×
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = Math.random().toString(36).slice(2, 9)
    setToasts(prev => [...prev.slice(-4), { id, message, variant }])
  }, [])

  const remove = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-label="Notifications"
        className="fixed top-[64px] right-4 z-[9998] flex flex-col gap-2 pointer-events-none"
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <SingleToast item={t} onRemove={remove} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
