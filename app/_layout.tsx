import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';

const LEAGUE_UNLOCK_KEY = 'ppl_league_unlocked';
const TEAM_KEY = 'ppl_selected_team';

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const checkGates = async () => {
      const leagueUnlocked = await AsyncStorage.getItem(LEAGUE_UNLOCK_KEY);
      const team = await AsyncStorage.getItem(TEAM_KEY);

      const current = '/' + segments.join('/');

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
