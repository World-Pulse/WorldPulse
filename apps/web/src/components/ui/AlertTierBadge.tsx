/**
 * AlertTierBadge
 *
 * Displays the urgency tier of a WorldPulse signal.
 * FLASH    — red, pulsing animation — maximum urgency
 * PRIORITY — orange — high urgency
 * ROUTINE  — gray — normal signal
 */

import type { AlertTier } from '@worldpulse/types'

interface AlertTierBadgeProps {
  tier: AlertTier
  size?: 'sm' | 'md'
  className?: string
}

const TIER_CONFIG: Record<AlertTier, {
  label:     string
  icon:      string
  bgClass:   string
  textClass: string
  ringClass: string
  pulse:     boolean
}> = {
  FLASH: {
    label:     'FLASH',
    icon:      '🔴',
    bgClass:   'bg-red-600',
    textClass: 'text-white',
    ringClass: 'ring-red-400',
    pulse:     true,
  },
  PRIORITY: {
    label:     'PRIORITY',
    icon:      '⚡',
    bgClass:   'bg-orange-500',
    textClass: 'text-white',
    ringClass: 'ring-orange-300',
    pulse:     false,
  },
  ROUTINE: {
    label:     'ROUTINE',
    icon:      '',
    bgClass:   'bg-gray-200',
    textClass: 'text-gray-600',
    ringClass: 'ring-gray-300',
    pulse:     false,
  },
}

export function AlertTierBadge({ tier, size = 'sm', className = '' }: AlertTierBadgeProps) {
  const config = TIER_CONFIG[tier]

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-1.5 py-0.5 gap-0.5'
    : 'text-xs px-2 py-1 gap-1'

  const pulseClass = config.pulse ? 'animate-pulse' : ''

  // Don't render a badge for ROUTINE signals — keeps the UI clean
  if (tier === 'ROUTINE') {
    return null
  }

  return (
    <span
      className={[
        'inline-flex items-center rounded font-bold uppercase tracking-wide ring-1',
        config.bgClass,
        config.textClass,
        config.ringClass,
        sizeClasses,
        pulseClass,
        className,
      ].filter(Boolean).join(' ')}
      title={`Alert tier: ${tier}`}
      aria-label={`Alert tier ${tier}`}
    >
      {config.icon && <span aria-hidden="true">{config.icon}</span>}
      <span>{config.label}</span>
    </span>
  )
}

export default AlertTierBadge
