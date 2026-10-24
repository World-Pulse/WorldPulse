/** A shading layer's colours and what each means, under its switch in the Layers panel (Oct 23, 2026) */
export function ScaleLegend({ title, colors, labels }: { title: string; colors: readonly string[]; labels: readonly string[] }) {
  return (
    <div>
      <div className="text-[10px] text-wp-text3 mb-1">{title}</div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        {colors.map((c, i) => (
          <span key={`${c}-${i}`} className="inline-flex items-center gap-1 text-[10px] text-wp-text2 tabular-nums">
            <i aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{labels[i]}
          </span>
        ))}
      </div>
    </div>
  )
}
