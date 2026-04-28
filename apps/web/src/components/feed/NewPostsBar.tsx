'use client'

export function NewPostsBar({ count, onLoad }: { count: number; onLoad: () => void }) {
  return (
    <div
      onClick={onLoad}
      className="flex items-center justify-center gap-2 py-[10px] bg-[rgba(245,166,35,0.1)] border-b border-[rgba(245,166,35,0.3)] cursor-pointer text-[13px] text-wp-amber font-medium hover:bg-[rgba(245,166,35,0.15)] transition-colors animate-slide-down"
    >
      <span className="animate-live-pulse inline-block">⚡</span>
      {count} new signal{count !== 1 ? 's' : ''} · Click to load
    </div>
  )
}
