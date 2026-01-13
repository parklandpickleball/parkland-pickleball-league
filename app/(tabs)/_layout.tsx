import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Tabs, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

const TEAM_KEY = 'ppl_selected_team';
const PLAYER_NAME_KEY = 'ppl_selected_player_name';

export default function TabLayout() {
  const router = useRouter();
  const [checkingGate, setCheckingGate] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkGate = async () => {
      try {
        const team = await AsyncStorage.getItem(TEAM_KEY);
        const player = await AsyncStorage.getItem(PLAYER_NAME_KEY);

        // Force team selection first
        if (!team || !player) {
          router.replace('/team');
          return;
        }
      } finally {
        if (mounted) setCheckingGate(false);
      }
    };

    void checkGate();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (checkingGate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'Schedule',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="scoring"
        options={{
          title: 'Scoring',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="create" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="results"
        options={{
          title: 'Results',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="trophy" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="standings"
        options={{
          title: 'Standings',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="list" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="announcements"
        options={{
          title: 'Announcements',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="megaphone" size={size} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="photos"
        options={{
          title: 'Photos',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="images" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
  name="admin-division-moves"
  options={{
    href: null, // ✅ hides it from the tab bar and deep links
  }}
/>


      <Tabs.Screen
        name="sponsors"
        options={{
          title: 'Sponsors',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="ribbon" size={size} color={color} />
          ),
        }}
      />

    <Tabs.Screen name="admin-teams" options={{ href: null }} />


      {/* Admin MUST be last */}
      <Tabs.Screen
        name="admin-lock"
        options={{
          title: 'Admin',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />

      {/* Hidden internal admin routes */}
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="admin-schedule" options={{ href: null }} />
      <Tabs.Screen name="admin-attendance" options={{ href: null }} />
      <Tabs.Screen name="admin-announcements" options={{ href: null }} />
    </Tabs>
  );
}
