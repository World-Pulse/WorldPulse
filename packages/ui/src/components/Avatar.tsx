import React from 'react'

export interface AvatarProps {
  src?: string | null
  alt: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  /** Show a verified ring around the avatar */
  verified?: boolean
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-xs',
  sm: 'w-8 h-8 text-sm',
  md: 'w-10 h-10 text-base',
  lg: 'w-12 h-12 text-lg',
  xl: 'w-16 h-16 text-xl',
}

const RING_MAP = {
  xs: 'ring-1',
  sm: 'ring-2',
  md: 'ring-2',
  lg: 'ring-2',
  xl: 'ring-[3px]',
}

function getInitials(alt: string): string {
  return alt
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('')
}

export function Avatar({ src, alt, size = 'md', className = '', verified = false }: AvatarProps) {
  const sizeClass = SIZE_MAP[size]
  const ringClass = RING_MAP[size]

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        className={`${sizeClass} rounded-full object-cover shrink-0 ${verified ? `${ringClass} ring-blue-500` : ''} ${className}`}
      />
    )
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-neutral-700 flex items-center justify-center font-semibold text-neutral-200 shrink-0 select-none ${verified ? `${ringClass} ring-blue-500` : ''} ${className}`}
      aria-label={alt}
    >
      {getInitials(alt)}
    </div>
  )
}
