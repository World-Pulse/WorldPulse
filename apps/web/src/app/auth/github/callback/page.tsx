'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function GitHubCallbackPage() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState('')

  useEffect(() => {
    const accessToken  = params.get('accessToken')
    const refreshToken = params.get('refreshToken')
    const errorParam   = params.get('error')

    if (errorParam || !accessToken || !refreshToken) {
      setError('GitHub login failed. Please try again.')
      setTimeout(() => router.replace('/auth/login?error=oauth_failed'), 2000)
      return
    }

    // Fetch user profile with the new access token
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    fetch(`${apiUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(data => {
        if (!data.success) throw new Error('Profile fetch failed')

        localStorage.setItem('wp_access_token', accessToken)
        localStorage.setItem('wp_refresh_token', refreshToken)
        localStorage.setItem('wp_user', JSON.stringify(data.data))

        window.dispatchEvent(new StorageEvent('storage', {
          key: 'wp_user',
          newValue: JSON.stringify(data.data),
        }))

        router.replace(data.data.onboarded ? '/' : '/onboarding')
      })
      .catch(() => {
        setError('Could not load your profile. Please try again.')
        setTimeout(() => router.replace('/auth/login?error=oauth_failed'), 2000)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-[calc(100vh-52px)] flex items-center justify-center px-4">
      <div className="text-center">
        {error ? (
          <p className="text-wp-red text-[14px]">{error}</p>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-wp-amber border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-wp-text2 text-[14px]">Signing you in with GitHub…</p>
          </>
        )}
      </div>
    </div>
  )
}
