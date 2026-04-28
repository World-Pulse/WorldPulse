'use client'

import React from 'react'
import { captureException } from '@/lib/sentry'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  eventId: string | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, eventId: null }
  }

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    captureException(error, {
      extra: { componentStack: info.componentStack ?? undefined },
    })
  }

  handleReset = (): void => {
    this.setState({ hasError: false, eventId: null })
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback
    }

    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-lg border border-white/10 bg-white/5 p-8 text-center">
        <div className="text-3xl" aria-hidden="true">⚠</div>
        <div>
          <p className="text-base font-semibold text-wp-text">Something went wrong</p>
          <p className="mt-1 text-sm text-wp-muted">
            This section failed to load. The error has been reported.
          </p>
        </div>
        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-md bg-wp-amber px-4 py-1.5 text-sm font-semibold text-black hover:bg-wp-amber/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wp-amber"
        >
          Try again
        </button>
      </div>
    )
  }
}
