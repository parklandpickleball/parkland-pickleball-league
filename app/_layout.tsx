import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const LEAGUE_UNLOCK_KEY = 'ppl_league_unlocked';
const TEAM_KEY = 'ppl_selected_team';
const PUSH_TOKEN_KEY = 'ppl_expo_push_token';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [ready, setReady] = useState(false);

  // ✅ Ensure notifications display even while app is open (foreground)
  useEffect(() => {
    try {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          // iOS presentation (newer Expo types)
          shouldShowBanner: true,
          shouldShowList: true,

          // Generic behavior
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    } catch {
      // no-op
    }
  }, []);

  // 🔔 Register for push notifications (ONE TIME, SAFE)
  useEffect(() => {
    const registerForPushNotifications = async () => {
      try {
        // ✅ Never request notifications on WEB (prevents localhost browser prompt)
        if (Platform.OS === 'web') return;

        // ✅ Expo Push Tokens require a real device
        if (!Device.isDevice) return;

        const { status: existingStatus } =
          await Notifications.getPermissionsAsync();

        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== 'granted') {
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync();
        await AsyncStorage.setItem(PUSH_TOKEN_KEY, tokenData.data);
      } catch {
        // Silent fail — NEVER block app or review
      }
    };

    registerForPushNotifications();
  }, []);

  // 🔐 Gate logic (UNCHANGED)
  useEffect(() => {
    const checkGates = async () => {
      const leagueUnlocked = await AsyncStorage.getItem(LEAGUE_UNLOCK_KEY);
      const team = await AsyncStorage.getItem(TEAM_KEY);

      const current = '/' + segments.join('/');

      // ✅ Allow root explicitly (prevents Unmatched Route timing crash)
      if (current === '/') {
        setReady(true);
        return;
      }

      // 🚫 League gate (first)
      if (!leagueUnlocked && current !== '/league-lock') {
        router.replace('/league-lock');
        return;
      }

      // 🚫 Team gate (after league unlock)
      if (leagueUnlocked && !team && current !== '/team') {
        router.replace('/team');
        return;
      }

      setReady(true);
    };

    checkGates();
  }, [segments]);

  if (!ready) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}
