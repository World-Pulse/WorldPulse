import Link from 'next/link'
import { LEVEL_COLOR, LEVEL_WORDS, scoreColor, type CommodityCard } from '@/lib/commodities'

// One card of the commodity watch (Oct 23, 2026): a commodity in a country, with its five
// readings, its plain score and the reasons for it. Used on /commodities and in the map's
// country brief (compact). No hooks: renders on the server or in the browser.

function Reading({ label, text, dot }: { label: string; text: string; dot?: string }) {
  return (
    <div className="flex gap-2 text-[12.5px] leading-snug">
      <span className="font-mono text-[9.5px] tracking-[1px] uppercase text-wp-text3 w-[62px] flex-none pt-[2px]">{label}</span>
      <span className="text-wp-text2 min-w-0 flex-1 break-words">
        {dot && <span className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle" style={{ background: dot }} aria-hidden="true" />}
        {text}
      </span>
    </div>
  )
}

export function ScoreBadge({ score, call }: { score: number; call: string | null }) {
  const color = scoreColor(score)
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px] tabular-nums whitespace-nowrap"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}55` }}
      title={call ? `Supply-risk score ${score} of 100: USDA's next revision, ${call}` : `Supply-risk score ${score} of 100`}>
      {score}{call ? <span className="opacity-80">· {call}</span> : null}
    </span>
  )
}

export function CommodityCardView({ card, compact = false, showCountry = false }: { card: CommodityCard; compact?: boolean; showCountry?: boolean }) {
  const title = showCountry ? card.country : card.commodity_name
  return (
    <article className={`rounded-xl border ${card.flag ? 'border-[rgba(239,68,68,0.45)] bg-[rgba(239,68,68,0.05)]' : 'border-white/[0.07] bg-white/[0.02]'} px-3.5 py-3`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-wp-text min-w-0 truncate">
          {showCountry
            ? <Link href={`/commodities?country=${card.iso}`} className="hover:text-wp-amber">{title}</Link>
            : <Link href={`/commodities?commodity=${encodeURIComponent(card.commodity)}`} className="hover:text-wp-amber">{title}</Link>}
        </h3>
        <ScoreBadge score={card.score} call={card.call} />
      </div>
      {card.flag && (
        <p className="mt-2 text-[12px] leading-snug text-red-200">
          <span className="font-mono text-[9.5px] tracking-[1px] uppercase text-red-300 mr-1.5">Supply risk not in the news</span>
        </p>
      )}
      <div className="mt-2 space-y-1.5">
        {card.outlook && <Reading label="Crop" text={card.outlook.text} />}
        {card.weather && <Reading label="Weather" text={card.weather.level ? `${LEVEL_WORDS[card.weather.level]} risk. ${card.weather.text}` : card.weather.text} dot={LEVEL_COLOR[card.weather.level] ?? LEVEL_COLOR[0]} />}
        {!compact && card.trade && <Reading label="Trade" text={card.trade.text} />}
        {card.market && <Reading label="Market" text={card.market.text} />}
        {card.news && <Reading label="News" text={card.news.text} />}
      </div>
      {!compact && card.reasons.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11.5px] text-wp-text3 hover:text-wp-text2">Why {card.score}</summary>
          <ul className="mt-1.5 space-y-1 text-[12px] text-wp-text2">
            {card.reasons.map(r => <li key={r} className="break-words">{r}</li>)}
          </ul>
        </details>
      )}
      {!compact && card.news && card.news.latest.length > 0 && (
        <ul className="mt-2 space-y-1">
          {card.news.latest.map(n => (
            <li key={n.id} className="text-[12px] leading-snug">
              <Link href={`/signals/${n.id}`} className="text-wp-text2 hover:text-wp-amber">{n.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
