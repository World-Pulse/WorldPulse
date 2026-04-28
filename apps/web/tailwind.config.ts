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
      colors: {
        'wp-bg':      '#06070d',
        'wp-surface': '#0d0f18',
        'wp-s2':      '#141722',
        'wp-s3':      '#1b2030',
        'wp-amber':   '#f5a623',
        'wp-cyan':    '#00d4ff',
        'wp-red':     '#ff3b5c',
        'wp-green':   '#00e676',
        'wp-text':    '#e2e6f0',
        'wp-text2':   '#8892a4',
        'wp-text3':   '#4a5568',
      },
      fontFamily: {
        display: ['Bebas Neue', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
        body:    ['DM Sans', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: 'rgba(255,255,255,0.07)',
        bright:  'rgba(255,255,255,0.15)',
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
