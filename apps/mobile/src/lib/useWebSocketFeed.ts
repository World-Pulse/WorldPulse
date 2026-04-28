import { useState, useEffect, useRef } from 'react'
import type { Signal } from './api'

export type WSEventType = 'signal.new' | 'alert.breaking'

export type WSEvent = {
  type: WSEventType
  data: Signal
}

export type UseWebSocketFeedResult = {
  signals: Signal[]
  isConnected: boolean
  lastEvent: WSEvent | null
}

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'wss://api.world-pulse.io/api/v1/ws'
const MAX_SIGNALS = 50
const MAX_BACKOFF_MS = 30_000
const INITIAL_BACKOFF_MS = 1_000

export function useWebSocketFeed(): UseWebSocketFeedResult {
  const [signals, setSignals] = useState<Signal[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<WSEvent | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const backoffRef = useRef(INITIAL_BACKOFF_MS)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isMountedRef = useRef(false)

  useEffect(() => {
    isMountedRef.current = true

    function scheduleReconnect() {
      if (!isMountedRef.current) return
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)

      const delay = backoffRef.current
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)

      reconnectTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) connect()
      }, delay)
    }

    function connect() {
      if (!isMountedRef.current) return

      let ws: WebSocket
      try {
        ws = new WebSocket(WS_URL)
      } catch {
        scheduleReconnect()
        return
      }

      wsRef.current = ws

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close()
          return
        }
        setIsConnected(true)
        backoffRef.current = INITIAL_BACKOFF_MS
      }

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return
        try {
          const parsed = JSON.parse(event.data as string) as WSEvent
          if (parsed.type === 'signal.new' || parsed.type === 'alert.breaking') {
            setLastEvent(parsed)
            setSignals((prev) => [parsed.data, ...prev].slice(0, MAX_SIGNALS))
          }
        } catch {
          // ignore malformed messages
        }
      }

      ws.onclose = () => {
        if (!isMountedRef.current) return
        setIsConnected(false)
        wsRef.current = null
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onerror is always followed by onclose; let onclose handle reconnect
        ws.close()
      }
    }

    connect()

    return () => {
      isMountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent scheduleReconnect on intentional close
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  return { signals, isConnected, lastEvent }
}
