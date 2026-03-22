'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthUser } from '@worldpulse/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// ─── Static data ──────────────────────────────────────────────────────────────

const WELCOME_SLIDES = [
  {
    label: '01 / SIGNALS',
    title: 'Real-time global intelligence',
    body: 'WorldPulse aggregates verified intelligence from wire agencies, journalists, and official sources — surfacing what matters, the moment it happens.',
  },
  {
    label: '02 / RELIABILITY',
    title: 'Know how much to trust',
    body: 'Every signal carries a reliability score from 0 to 1. It rises with each corroborating source, cross-check, and expert verification — so you always know what you are reading.',
  },
  {
    label: '03 / CONTRIBUTE',
    title: 'You are the network',
    body: 'Flag misinformation, post on-the-ground reports, and build your trust score over time. The more you contribute verified intelligence, the stronger the network becomes.',
  },
] as const

const INTERESTS = [
  { id: 'conflict',    label: 'Conflict' },
  { id: 'climate',     label: 'Climate' },
  { id: 'geopolitics', label: 'Politics' },
  { id: 'health',      label: 'Health' },
  { id: 'technology',  label: 'Technology' },
  { id: 'economy',     label: 'Economy' },
  { id: 'disaster',    label: 'Natural Disasters' },
  { id: 'science',     label: 'Science' },
] as const

const REGIONS = [
  'North America',
  'South America',
  'Europe',
  'Middle East',
  'Africa',
  'South Asia',
  'East Asia',
  'Southeast Asia',
  'Central Asia',
  'Oceania',
] as const

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestedUser {
  id:            string
  handle:        string
  display_name:  string
  bio:           string | null
  avatar_url:    string | null
  account_type:  string
  trust_score:   number
  follower_count: number
  verified:      boolean
}

const STEPS = ['welcome', 'interests', 'regions', 'suggestions'] as const
type StepId = typeof STEPS[number]

// ─── Root component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  // Gate: must be authenticated and not yet onboarded
  useEffect(() => {
    const stored = localStorage.getItem('wp_user')
    if (!stored) {
      router.replace('/auth/login')
      return
    }
    const u = JSON.parse(stored) as AuthUser
    if (u.onboarded) {
      router.replace('/')
      return
    }
    setReady(true)
  }, [router])

  // Step navigation
  const [stepIndex, setStepIndex]             = useState(0)
  const [slideIndex, setSlideIndex]           = useState(0)

  // Selections
  const [selectedInterests, setSelectedInterests] = useState<Set<string>>(new Set())
  const [selectedRegions,   setSelectedRegions]   = useState<Set<string>>(new Set())
  const [suggestions,       setSuggestions]       = useState<SuggestedUser[]>([])
  const [following,         setFollowing]         = useState<Set<string>>(new Set())
  const [completing,        setCompleting]        = useState(false)

  const currentStep: StepId = STEPS[stepIndex]

  // Fetch follow suggestions when that step is active
  useEffect(() => {
    if (currentStep !== 'suggestions') return
    const token = localStorage.getItem('wp_access_token')
    fetch(`${API_URL}/api/v1/users/suggestions/follow`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(r => r.json())
      .then(d => { if (d.success) setSuggestions(d.data as SuggestedUser[]) })
      .catch(() => {})
  }, [currentStep])

  const completeOnboarding = useCallback(async (skip = false) => {
    if (completing) return
    setCompleting(true)
    const token = localStorage.getItem('wp_access_token')
    try {
      await fetch(`${API_URL}/api/v1/users/me/onboarding`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          interests:    skip ? [] : Array.from(selectedInterests),
          regions:      skip ? [] : Array.from(selectedRegions),
          followHandles: skip ? [] : Array.from(following),
        }),
      })
    } catch {
      // Non-fatal — mark onboarded locally regardless
    }

    // Update local storage so components don't redirect back to onboarding
    const stored = localStorage.getItem('wp_user')
    if (stored) {
      const u: AuthUser = JSON.parse(stored)
      u.onboarded = true
      localStorage.setItem('wp_user', JSON.stringify(u))
      window.dispatchEvent(new StorageEvent('storage', { key: 'wp_user', newValue: JSON.stringify(u) }))
    }

    router.push('/')
  }, [completing, selectedInterests, selectedRegions, following, router])

  const toggleInterest = (id: string) =>
    setSelectedInterests(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleRegion = (r: string) =>
    setSelectedRegions(prev => { const n = new Set(prev); n.has(r) ? n.delete(r) : n.add(r); return n })

  const toggleFollow = (handle: string) =>
    setFollowing(prev => { const n = new Set(prev); n.has(handle) ? n.delete(handle) : n.add(handle); return n })

  const nextStep = () => {
    if (stepIndex < STEPS.length - 1) setStepIndex(i => i + 1)
    else void completeOnboarding()
  }
  const prevStep = () => setStepIndex(i => Math.max(0, i - 1))

  if (!ready) return null

  const progress = (stepIndex / (STEPS.length - 1)) * 100

  return (
    <div className="fixed inset-0 z-50 bg-wp-bg flex flex-col overflow-hidden">
      {/* Progress bar */}
      <div className="h-0.5 bg-wp-s2 w-full flex-shrink-0">
        <div
          className="h-full bg-wp-amber transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Skip */}
      <div className="flex justify-between items-center px-6 pt-4 flex-shrink-0">
        <span className="font-display text-[16px] tracking-[2px] text-wp-text">
          WORLD<span className="text-wp-amber">PULSE</span>
        </span>
        <button
          onClick={() => void completeOnboarding(true)}
          className="text-[13px] text-wp-text3 hover:text-wp-text2 transition-colors"
        >
          Skip setup
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 overflow-y-auto">
        <div className="w-full max-w-lg">
          {currentStep === 'welcome' && (
            <WelcomeStep
              slideIndex={slideIndex}
              onSlide={setSlideIndex}
              onNext={nextStep}
            />
          )}
          {currentStep === 'interests' && (
            <InterestsStep
              selected={selectedInterests}
              onToggle={toggleInterest}
              onNext={nextStep}
              onBack={prevStep}
            />
          )}
          {currentStep === 'regions' && (
            <RegionsStep
              selected={selectedRegions}
              onToggle={toggleRegion}
              onNext={nextStep}
              onBack={prevStep}
            />
          )}
          {currentStep === 'suggestions' && (
            <SuggestionsStep
              suggestions={suggestions}
              following={following}
              onToggle={toggleFollow}
              onFinish={() => void completeOnboarding()}
              onBack={prevStep}
              completing={completing}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step: Welcome ────────────────────────────────────────────────────────────

function WelcomeStep({
  slideIndex,
  onSlide,
  onNext,
}: {
  slideIndex: number
  onSlide:   (i: number) => void
  onNext:    () => void
}) {
  const slide  = WELCOME_SLIDES[slideIndex]
  const isLast = slideIndex === WELCOME_SLIDES.length - 1

  return (
    <div className="flex flex-col gap-8">
      {/* Slide card */}
      <div
        key={slideIndex}
        className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-8 animate-fade-in"
      >
        <div className="text-[11px] text-wp-amber font-mono tracking-widest mb-5">
          {slide.label}
        </div>
        <h2 className="font-display text-[32px] leading-tight tracking-[1px] text-wp-text mb-4">
          {slide.title.toUpperCase()}
        </h2>
        <p className="text-[15px] text-wp-text2 leading-relaxed">
          {slide.body}
        </p>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-2">
        {WELCOME_SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => onSlide(i)}
            aria-label={`Slide ${i + 1}`}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === slideIndex ? 'bg-wp-amber' : 'bg-wp-s3'
            }`}
          />
        ))}
      </div>

      {/* Nav */}
      <div className="flex gap-3">
        {slideIndex > 0 && (
          <button
            onClick={() => onSlide(slideIndex - 1)}
            className="flex-1 py-2.5 text-[14px] text-wp-text2 border border-[rgba(255,255,255,0.08)] rounded-lg hover:border-[rgba(255,255,255,0.2)] transition-colors"
          >
            Back
          </button>
        )}
        <button
          onClick={isLast ? onNext : () => onSlide(slideIndex + 1)}
          className="flex-1 py-2.5 bg-wp-amber text-black font-bold text-[14px] rounded-lg hover:bg-[#ffb84d] transition-colors"
        >
          {isLast ? 'Get Started' : 'Next'}
        </button>
      </div>
    </div>
  )
}

// ─── Step: Interests ──────────────────────────────────────────────────────────

function InterestsStep({
  selected,
  onToggle,
  onNext,
  onBack,
}: {
  selected: Set<string>
  onToggle: (id: string) => void
  onNext:   () => void
  onBack:   () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-[30px] tracking-[1px] text-wp-text">
          WHAT MATTERS TO YOU
        </h2>
        <p className="text-[14px] text-wp-text2 mt-2">
          Select topics to follow. You can change these any time in settings.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {INTERESTS.map(({ id, label }) => {
          const active = selected.has(id)
          return (
            <button
              key={id}
              onClick={() => onToggle(id)}
              className={`py-4 px-4 rounded-xl border text-left text-[14px] font-medium transition-all ${
                active
                  ? 'bg-[rgba(245,166,35,0.12)] border-wp-amber text-wp-amber'
                  : 'glass border-[rgba(255,255,255,0.07)] text-wp-text2 hover:border-[rgba(255,255,255,0.18)] hover:text-wp-text'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextLabel={selected.size === 0 ? 'Skip' : 'Continue'}
      />
    </div>
  )
}

// ─── Step: Regions ────────────────────────────────────────────────────────────

function RegionsStep({
  selected,
  onToggle,
  onNext,
  onBack,
}: {
  selected: Set<string>
  onToggle: (region: string) => void
  onNext:   () => void
  onBack:   () => void
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-[30px] tracking-[1px] text-wp-text">
          YOUR REGIONS
        </h2>
        <p className="text-[14px] text-wp-text2 mt-2">
          Prioritise signals from regions you care about.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {REGIONS.map(region => {
          const active = selected.has(region)
          return (
            <button
              key={region}
              onClick={() => onToggle(region)}
              className={`py-3 px-4 rounded-xl border text-left text-[13px] font-medium transition-all ${
                active
                  ? 'bg-[rgba(0,212,255,0.08)] border-wp-cyan text-wp-cyan'
                  : 'glass border-[rgba(255,255,255,0.07)] text-wp-text2 hover:border-[rgba(255,255,255,0.18)] hover:text-wp-text'
              }`}
            >
              {region}
            </button>
          )
        })}
      </div>

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextLabel={selected.size === 0 ? 'Skip' : 'Continue'}
      />
    </div>
  )
}

// ─── Step: Follow suggestions ─────────────────────────────────────────────────

function SuggestionsStep({
  suggestions,
  following,
  onToggle,
  onFinish,
  onBack,
  completing,
}: {
  suggestions: SuggestedUser[]
  following:   Set<string>
  onToggle:    (handle: string) => void
  onFinish:    () => void
  onBack:      () => void
  completing:  boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-[30px] tracking-[1px] text-wp-text">
          SUGGESTED ACCOUNTS
        </h2>
        <p className="text-[14px] text-wp-text2 mt-2">
          Follow verified journalists, official sources, and domain experts.
        </p>
      </div>

      <div className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto pr-1">
        {suggestions.length === 0 && (
          <div className="py-10 text-center text-[14px] text-wp-text3">
            No suggestions available yet — check back after more sources are added.
          </div>
        )}
        {suggestions.map(user => {
          const isFollowing = following.has(user.handle)
          return (
            <div
              key={user.id}
              className="glass border border-[rgba(255,255,255,0.07)] rounded-xl p-4 flex items-center gap-4"
            >
              {/* Avatar initials */}
              <div className="w-10 h-10 rounded-full bg-wp-s3 flex items-center justify-center text-[15px] font-bold text-wp-amber flex-shrink-0">
                {user.display_name[0].toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-wp-text truncate">
                    {user.display_name}
                  </span>
                  {user.verified && (
                    <span className="text-[10px] text-wp-cyan font-mono tracking-widest">
                      VERIFIED
                    </span>
                  )}
                  <span className="text-[11px] text-wp-text3 font-mono">
                    {user.account_type}
                  </span>
                </div>
                <div className="text-[12px] text-wp-text3">@{user.handle}</div>
                {user.bio && (
                  <div className="text-[12px] text-wp-text2 mt-0.5 line-clamp-1">
                    {user.bio}
                  </div>
                )}
              </div>

              <button
                onClick={() => onToggle(user.handle)}
                className={`flex-shrink-0 px-3 py-1.5 text-[12px] font-bold rounded-lg transition-colors ${
                  isFollowing
                    ? 'bg-[rgba(245,166,35,0.15)] text-wp-amber border border-wp-amber'
                    : 'bg-wp-amber text-black hover:bg-[#ffb84d]'
                }`}
              >
                {isFollowing ? 'Following' : 'Follow'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-2.5 text-[14px] text-wp-text2 border border-[rgba(255,255,255,0.08)] rounded-lg hover:border-[rgba(255,255,255,0.2)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={onFinish}
          disabled={completing}
          className="flex-1 py-2.5 bg-wp-amber text-black font-bold text-[14px] rounded-lg hover:bg-[#ffb84d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {completing ? 'Setting up…' : 'Enter WorldPulse'}
        </button>
      </div>
    </div>
  )
}

// ─── Shared nav buttons ───────────────────────────────────────────────────────

function NavButtons({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack:    () => void
  onNext:    () => void
  nextLabel: string
}) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onBack}
        className="flex-1 py-2.5 text-[14px] text-wp-text2 border border-[rgba(255,255,255,0.08)] rounded-lg hover:border-[rgba(255,255,255,0.2)] transition-colors"
      >
        Back
      </button>
      <button
        onClick={onNext}
        className="flex-1 py-2.5 bg-wp-amber text-black font-bold text-[14px] rounded-lg hover:bg-[#ffb84d] transition-colors"
      >
        {nextLabel}
      </button>
    </div>
  )
}
