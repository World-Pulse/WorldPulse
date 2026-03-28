import { useState, useEffect, useRef } from 'react'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { notificationsApi } from './api'

type PermissionStatus = 'granted' | 'denied' | 'undetermined'

export type UsePushNotificationsResult = {
  expoPushToken: string | null
  notificationPermission: PermissionStatus
}

export function usePushNotifications(): UsePushNotificationsResult {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null)
  const [notificationPermission, setNotificationPermission] = useState<PermissionStatus>('undetermined')
  const hasRun = useRef(false)

  useEffect(() => {
    if (hasRun.current) return
    hasRun.current = true

    async function setup() {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('worldpulse', {
          name: 'WorldPulse Alerts',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#38bdf8',
        })
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync()
      let finalStatus = existingStatus

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync()
        finalStatus = status
      }

      setNotificationPermission(finalStatus as PermissionStatus)

      if (finalStatus !== 'granted') return

      try {
        const tokenData = await Notifications.getExpoPushTokenAsync()
        setExpoPushToken(tokenData.data)
        await notificationsApi.registerDeviceToken(tokenData.data, 'expo')
      } catch (err) {
        console.warn('[usePushNotifications] Failed to register push token:', err)
      }
    }

    setup()
  }, [])

  return { expoPushToken, notificationPermission }
}
