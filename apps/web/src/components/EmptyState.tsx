'use client'

import Link from 'next/link'

export interface EmptyStateProps {
  icon:     string
  headline: string
  message:  string
  cta?:     { label: string; href?: string; onClick?: () => void }
  compact?: boolean
}

export function EmptyState({ icon, headline, message, cta, compact }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${compact ? 'py-12' : 'py-20'}`}>
      <div className={`${compact ? 'text-[40px] mb-3' : 'text-[52px] mb-4'} opacity-75`} aria-hidden="true">
        {icon}
      </div>
      <div className={`font-semibold text-wp-text mb-2 ${compact ? 'text-[15px]' : 'text-[17px]'}`}>
        {headline}
      </div>
      <div className={`text-wp-text3 max-w-xs leading-relaxed ${compact ? 'text-[12px] mb-4' : 'text-[13px] mb-6'}`}>
        {message}
      </div>
      {cta && (
        cta.href ? (
          <Link
            href={cta.href}
            className={`px-5 rounded-full bg-wp-amber text-black font-bold hover:bg-[#ffb84d] transition-all ${compact ? 'py-2 text-[12px]' : 'py-[9px] text-[13px]'}`}
          >
            {cta.label}
          </Link>
        ) : (
          <button
            onClick={cta.onClick}
            className={`px-5 rounded-full bg-wp-amber text-black font-bold hover:bg-[#ffb84d] transition-all ${compact ? 'py-2 text-[12px]' : 'py-[9px] text-[13px]'}`}
          >
            {cta.label}
          </button>
        )
      )}
    </div>
  )
}
