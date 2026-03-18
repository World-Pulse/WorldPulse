'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { Post, Signal, TrendingTopic, WSMessage } from '@worldpulse/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
const WS_URL  = process.env.NEXT_PUBLIC_WS_URL  ?? 'ws://localhost:3001'

// ─── TYPES ────────────────────────────────────────────────────────────────
type FeedTab = 'global' | 'following' | 'verified' | 'digest'
type FilterCategory = 'all' | 'breaking' | 'conflict' | 'climate' | 'economy' | 'technology' | 'health'

// ─── MAIN PAGE ────────────────────────────────────────────────────────────
export default function FeedPage() {
  const [posts, setPosts]         = useState<Post[]>([])
  const [signals, setSignals]     = useState<Signal[]>([])
  const [trending, setTrending]   = useState<TrendingTopic[]>([])
  const [newCount, setNewCount]   = useState(0)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState<FeedTab>('global')
  const [category, setCategory]   = useState<FilterCategory>('all')
  const [cursor, setCursor]       = useState<string | null>(null)
  const [hasMore, setHasMore]     = useState(true)
  const [connected, setConnected] = useState(false)
  
  const wsRef    = useRef<WebSocket | null>(null)
  const pendingRef = useRef<Post[]>([])

  // ─── FETCH FEED ──────────────────────────────────────────────────────
  const fetchFeed = useCallback(async (reset = false) => {
    if (loading && !reset) return
    setLoading(true)
    
    try {
      const params = new URLSearchParams({
        limit: '20',
        ...(category !== 'all' && { category }),
        ...(!reset && cursor ? { cursor } : {}),
      })
      
      const endpoint = activeTab === 'global' ? 'feed/global' : 
                       activeTab === 'verified' ? 'feed/signals' : 'feed/following'

      const res  = await fetch(`${API_URL}/api/v1/${endpoint}?${params}`)
      const data = await res.json() as { items: Post[]; cursor: string | null; hasMore: boolean }
      
      setPosts(prev => reset ? data.items : [...prev, ...data.items])
      setCursor(data.cursor)
      setHasMore(data.hasMore)
    } catch (err) {
      console.error('Feed fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [activeTab, category, cursor, loading])

  // ─── FETCH TRENDING ──────────────────────────────────────────────────
  const fetchTrending = useCallback(async () => {
    try {
      const res  = await fetch(`${API_URL}/api/v1/feed/trending?window=1h`)
      const data = await res.json() as { items: TrendingTopic[] }
      setTrending(data.items ?? [])
    } catch { /* silent */ }
  }, [])

  // ─── WEBSOCKET ───────────────────────────────────────────────────────
  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      ws.send(JSON.stringify({ type: 'subscribe', payload: { channels: ['all'] } }))
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data) as WSMessage
        
        if (msg.event === 'post.new') {
          const post = (msg.data as { post: Post }).post
          pendingRef.current = [post, ...pendingRef.current]
          setNewCount(n => n + 1)
        }
        
        if (msg.event === 'signal.new') {
          const signal = (msg.data as { signal: Signal }).signal
          setSignals(prev => [signal, ...prev.slice(0, 99)])
        }

        if (msg.event === 'trending.update') {
          const { topics } = msg.data as { topics: TrendingTopic[] }
          setTrending(topics)
        }

        if (msg.event === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }))
        }
      } catch { /* ignore */ }
    }

    return () => ws.close()
  }, [])

  // ─── INITIAL LOAD ────────────────────────────────────────────────────
  useEffect(() => {
    fetchFeed(true)
    fetchTrending()
  }, [activeTab, category]) // eslint-disable-line

  // Refresh trending every 5 min
  useEffect(() => {
    const interval = setInterval(fetchTrending, 5 * 60_000)
    return () => clearInterval(interval)
  }, [fetchTrending])

  const loadNew = () => {
    setPosts(prev => [...pendingRef.current, ...prev])
    pendingRef.current = []
    setNewCount(0)
  }

  return {
    // State
    posts, signals, trending, newCount, loading, activeTab,
    category, hasMore, connected,
    // Actions
    setActiveTab: (tab: FeedTab) => { setActiveTab(tab); setCursor(null) },
    setCategory:  (cat: FilterCategory) => { setCategory(cat); setCursor(null) },
    loadMore:     () => fetchFeed(false),
    loadNew,
    refresh:      () => fetchFeed(true),
  }
}
