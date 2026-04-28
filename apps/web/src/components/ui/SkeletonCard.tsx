'use client'

// ─── Skeleton primitive ────────────────────────────────────────────────────────
// Renders a shimmer placeholder using the .shimmer CSS class defined in globals.css.
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded ${className}`} aria-hidden="true" />
}

// ─── SkeletonCard ──────────────────────────────────────────────────────────────
// Feed-item sized skeleton — mirrors the layout of a signal card in FeedList.
// Use when loading the main feed, following feed, or any signal list.
export function SkeletonCard() {
  return (
    <div
      className="flex gap-3 px-5 py-4 border-b border-[rgba(255,255,255,0.05)]"
      aria-hidden="true"
    >
      {/* Avatar */}
      <Skeleton className="w-[42px] h-[42px] rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-2 min-w-0">
        {/* Name + handle + timestamp */}
        <div className="flex items-center gap-2">
          <Skeleton className="h-[13px] w-28" />
          <Skeleton className="h-[13px] w-16" />
          <Skeleton className="h-[13px] w-10 ml-auto" />
        </div>
        {/* Signal event card block */}
        <Skeleton className="h-[90px] rounded-[10px]" />
        {/* Tag pills */}
        <div className="flex gap-2">
          <Skeleton className="h-[18px] w-16 rounded-full" />
          <Skeleton className="h-[18px] w-20 rounded-full" />
          <Skeleton className="h-[18px] w-14 rounded-full" />
        </div>
        {/* Action bar */}
        <div className="flex gap-2 mt-1">
          <Skeleton className="h-[28px] w-14 rounded-full" />
          <Skeleton className="h-[28px] w-14 rounded-full" />
          <Skeleton className="h-[28px] w-14 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ─── SkeletonSignalSearchCard ──────────────────────────────────────────────────
// Skeleton that matches the SignalSearchCard layout in search/page.tsx.
export function SkeletonSignalSearchCard() {
  return (
    <div
      className="bg-wp-surface border border-[rgba(255,255,255,0.07)] rounded-xl p-4"
      aria-hidden="true"
    >
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-[18px] w-16" />
        <Skeleton className="h-[18px] w-12" />
        <Skeleton className="h-[18px] w-24 ml-auto" />
      </div>
      <Skeleton className="h-5 w-4/5 mb-2" />
      <Skeleton className="h-4 w-2/5" />
    </div>
  )
}

// ─── SkeletonSidebarWidget ─────────────────────────────────────────────────────
// Compact skeleton for sidebar panel widgets (reliability, risk score, etc.).
export function SkeletonSidebarWidget() {
  return (
    <div
      className="p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] space-y-3"
      aria-hidden="true"
    >
      <Skeleton className="h-[10px] w-20" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-7 w-12 rounded-lg" />
      </div>
      <Skeleton className="h-1.5 rounded-full" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-8 rounded" />
        <Skeleton className="h-8 rounded" />
      </div>
    </div>
  )
}
