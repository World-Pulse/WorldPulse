import { useEffect, useRef } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import { notificationsApi } from '@/lib/api'

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
    },
  },
})

function AuthGate() {
  const router = useRouter()
  const segments = useSegments()
  const { isAuthenticated, isLoading, loadUser } = useAuthStore()
  const notificationListener = useRef<Notifications.EventSubscription | undefined>()
  const responseListener = useRef<Notifications.EventSubscription | undefined>()

  // Load user on mount
  useEffect(() => {
    loadUser()
  }, [])

  // Handle auth routing
  useEffect(() => {
    if (isLoading) return

    const inAuthGroup = segments[0] === 'auth'

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/auth/login')
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)/')
    }
  }, [isAuthenticated, isLoading, segments])

  // Push notification setup
  useEffect(() => {
    registerForPushNotifications()

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      // Notification received while app is in foreground
      console.log('Notification received:', notification)
    })

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      // User tapped on notification
      const { data } = response.notification.request.content
      if (data?.signalId) {
        router.push(`/signal/${data.signalId}`)
      } else if (data?.type === 'alert') {
        router.push('/(tabs)/alerts')
      }
    })

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current)
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current)
      }
    }
  }, [])

  return null
}

async function registerForPushNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('worldpulse', {
      name: 'WorldPulse Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#f5a623',
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }

  if (finalStatus !== 'granted') return

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync()
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      await notificationsApi.registerDeviceToken(tokenData.data, 'expo')
    }
  } catch (err) {
    console.warn('Failed to get push token:', err)
  }
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="light" backgroundColor="#06070d" />
      <AuthGate />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0d0f18' },
          headerTintColor: '#e2e6f0',
          headerTitleStyle: { fontWeight: '700', fontSize: 16 },
          contentStyle: { backgroundColor: '#06070d' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/login" options={{ headerShown: false }} />
        <Stack.Screen name="auth/register" options={{ headerShown: false }} />
        <Stack.Screen
          name="signal/[id]"
          options={{
            title: 'Signal',
            headerStyle: { backgroundColor: '#0d0f18' },
          }}
        />
      </Stack>
    </QueryClientProvider>
  )
}
