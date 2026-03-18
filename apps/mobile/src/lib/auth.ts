import { create } from 'zustand'
import { authApi, setTokens, clearTokens, getAccessToken, type UserProfile } from './api'

type AuthState = {
  user: UserProfile | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  register: (handle: string, displayName: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  loadUser: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const res = await authApi.login(email, password)
      await setTokens(res.data.accessToken, res.data.refreshToken)
      set({ user: res.data.user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed'
      set({ error: message, isLoading: false })
      throw err
    }
  },

  register: async (handle, displayName, email, password) => {
    set({ isLoading: true, error: null })
    try {
      const res = await authApi.register(handle, displayName, email, password)
      await setTokens(res.data.accessToken, res.data.refreshToken)
      set({ user: res.data.user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      set({ error: message, isLoading: false })
      throw err
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch { /* ignore server errors on logout */ }
    await clearTokens()
    set({ user: null, isAuthenticated: false, error: null })
  },

  loadUser: async () => {
    set({ isLoading: true })
    try {
      const token = await getAccessToken()
      if (!token) {
        set({ isLoading: false, isAuthenticated: false, user: null })
        return
      }
      const res = await authApi.me()
      set({ user: res.data, isAuthenticated: true, isLoading: false })
    } catch {
      await clearTokens()
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
