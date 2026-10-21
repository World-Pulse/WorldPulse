import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // The neutrals follow the theme (plan D4, Oct 21, 2026): they were fixed
      // dark values, so in the light theme panels stayed dark and text on the
      // page's light background could be unreadable. Each is its channels in
      // globals.css (--wp-*-rgb, redefined under html.light), so opacity
      // modifiers (text-wp-text/60) keep working. The accents stay fixed.
      colors: {
        'wp-bg':      'rgb(var(--wp-bg-rgb) / <alpha-value>)',
        'wp-surface': 'rgb(var(--wp-surface-rgb) / <alpha-value>)',
        'wp-s2':      'rgb(var(--wp-s2-rgb) / <alpha-value>)',
        'wp-s3':      'rgb(var(--wp-s3-rgb) / <alpha-value>)',
        'wp-amber':   '#f5a623',
        'wp-cyan':    '#00d4ff',
        'wp-red':     '#ff3b5c',
        'wp-green':   '#00e676',
        'wp-text':    'rgb(var(--wp-text-rgb) / <alpha-value>)',
        'wp-text2':   'rgb(var(--wp-text2-rgb) / <alpha-value>)',
        'wp-text3':   'rgb(var(--wp-text3-rgb) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
        body:    ['DM Sans', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: 'var(--wp-border)',
        bright:  'var(--wp-border-bright)',
      },
      animation: {
        'live-pulse':  'live-pulse 1.4s ease-in-out infinite',
        'fade-in':     'fade-in 0.4s ease forwards',
        'slide-down':  'slide-down 0.4s ease forwards',
        'ticker':      'ticker-scroll 60s linear infinite',
        'flash-tag':   'flash-tag 2s ease infinite',
        'pulse-ring':  'pulse-ring 2s ease-out infinite',
      },
      keyframes: {
        'live-pulse': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%':       { opacity: '0.4', transform: 'scale(0.7)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { transform: 'translateY(-100%)', opacity: '0' },
          to:   { transform: 'translateY(0)', opacity: '1' },
        },
        'ticker-scroll': {
          '0%':   { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'flash-tag': {
          '0%, 100%': { opacity: '1' },
          '50%':       { opacity: '0.6' },
        },
        'pulse-ring': {
          '0%':   { width: '8px', height: '8px', opacity: '0.9' },
          '100%': { width: '32px', height: '32px', opacity: '0' },
        },
      },
      boxShadow: {
        'amber-glow': '0 0 20px rgba(245,166,35,0.3)',
        'red-glow':   '0 0 20px rgba(255,59,92,0.3)',
        'cyan-glow':  '0 0 20px rgba(0,212,255,0.3)',
      },
    },
  },
  plugins: [],
}

export default config
