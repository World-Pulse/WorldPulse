// Next.js streaming skeleton shown while the signal detail page fetches server-side.
// Mirrors the two-column layout of SignalDetailClient (main content + sidebar).

export default function SignalDetailLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 lg:grid lg:grid-cols-[1fr_300px] lg:gap-6">
      {/* ── Main column ── */}
      <div className="space-y-4 min-w-0">
        {/* Badge row */}
        <div className="flex flex-wrap gap-2">
          <div className="h-[22px] w-20 rounded shimmer" />
          <div className="h-[22px] w-24 rounded shimmer" />
          <div className="h-[22px] w-28 rounded shimmer" />
        </div>

        {/* Title */}
        <div className="h-8 w-4/5 rounded shimmer" />
        <div className="h-6 w-3/5 rounded shimmer" />

        {/* Meta row: location · date · sources */}
        <div className="flex flex-wrap gap-3">
          <div className="h-4 w-24 rounded shimmer" />
          <div className="h-4 w-20 rounded shimmer" />
          <div className="h-4 w-16 rounded shimmer" />
        </div>

        {/* Summary block */}
        <div className="h-[80px] rounded-xl shimmer" />

        {/* Body text lines */}
        <div className="space-y-2">
          <div className="h-4 w-full rounded shimmer" />
          <div className="h-4 w-full rounded shimmer" />
          <div className="h-4 w-4/5 rounded shimmer" />
          <div className="h-4 w-3/4 rounded shimmer" />
        </div>

        {/* AI Summary placeholder */}
        <div className="h-[72px] rounded-xl shimmer" />

        {/* Tag pills */}
        <div className="flex gap-2 flex-wrap">
          <div className="h-[22px] w-16 rounded-full shimmer" />
          <div className="h-[22px] w-20 rounded-full shimmer" />
          <div className="h-[22px] w-14 rounded-full shimmer" />
        </div>

        {/* Map placeholder */}
        <div className="h-[200px] rounded-xl shimmer" />

        {/* Verification timeline */}
        <div className="h-[120px] rounded-xl shimmer" />
      </div>

      {/* ── Sidebar (desktop only) ── */}
      <div className="hidden lg:block space-y-4 mt-0">
        {/* Reliability widget */}
        <div className="p-4 rounded-xl border border-white/[0.07] space-y-3">
          <div className="h-[10px] w-20 rounded shimmer" />
          <div className="flex items-center justify-between">
            <div className="h-5 w-28 rounded shimmer" />
            <div className="h-7 w-12 rounded-lg shimmer" />
          </div>
          <div className="h-1.5 rounded-full shimmer" />
          <div className="grid grid-cols-2 gap-2">
            <div className="h-8 rounded shimmer" />
            <div className="h-8 rounded shimmer" />
          </div>
        </div>

        {/* Risk score widget */}
        <div className="h-[130px] rounded-xl shimmer" />

        {/* Related signals */}
        <div className="space-y-2">
          <div className="h-[10px] w-24 rounded shimmer" />
          <div className="h-[68px] rounded-xl shimmer" />
          <div className="h-[68px] rounded-xl shimmer" />
          <div className="h-[68px] rounded-xl shimmer" />
        </div>
      </div>
    </div>
  )
}
