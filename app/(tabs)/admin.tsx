import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';

const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';

export default function AdminScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [isUnlocked, setIsUnlocked] = useState(false);

  const checkAdmin = useCallback(async () => {
    try {
      const v = await AsyncStorage.getItem(ADMIN_UNLOCK_KEY);
      const ok = v === 'true';
      setIsUnlocked(ok);

      if (!ok) {
        router.replace('/admin-lock');
      }
    } finally {
      setChecking(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      setChecking(true);
      void checkAdmin();
    }, [checkAdmin])
  );

  const onLock = async () => {
    await AsyncStorage.setItem(ADMIN_UNLOCK_KEY, 'false');
    setIsUnlocked(false);

    Alert.alert('Locked', 'Admin has been locked.');
    router.replace('/admin-lock');
  };

  const goToScheduleBuilder = () => {
    router.push('/admin-schedule');
  };

  const goToAttendance = () => {
    router.push('/admin-attendance' as any);
  };

  const goToAdminAnnouncements = () => {
    router.push('/admin-announcements');
  };

  const goToDivisionMoves = () => {
    router.push('/admin-division-moves' as any);
  };

  const goToManageTeams = () => {
    router.push('/admin-teams' as any);
  };

  if (checking) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isUnlocked) {
    return (
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ fontSize: 18, fontWeight: '800' }}>
          Redirecting to Admin Lock…
        </Text>
      </View>
    );
  }

  const buttonStyle = {
    backgroundColor: '#111',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center' as const,
    marginBottom: 12,
    maxWidth: 260,
  };

  const buttonTextStyle = {
    color: 'white',
    fontSize: 16,
    fontWeight: '700' as const,
  };

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>
        Admin Dashboard
      </Text>

      <Text style={{ marginBottom: 18 }}>Choose an admin tool below.</Text>

      <Pressable onPress={goToScheduleBuilder} style={buttonStyle}>
        <Text style={buttonTextStyle}>Schedule Builder</Text>
      </Pressable>

      <Pressable onPress={goToAttendance} style={buttonStyle}>
        <Text style={buttonTextStyle}>Attendance</Text>
      </Pressable>

      <Pressable onPress={goToAdminAnnouncements} style={buttonStyle}>
        <Text style={buttonTextStyle}>Admin Announcements</Text>
      </Pressable>

      {/* ✅ RESTORED: Division Moves button */}
      <Pressable onPress={goToDivisionMoves} style={buttonStyle}>
        <Text style={buttonTextStyle}>Division Moves (Mid-Season)</Text>
      </Pressable>

      {/* ✅ NEW: Manage Teams button */}
      <Pressable onPress={goToManageTeams} style={buttonStyle}>
        <Text style={buttonTextStyle}>Manage Teams (Add Mid-Season)</Text>
      </Pressable>

      <Pressable
        onPress={onLock}
        style={{
          backgroundColor: 'black',
          padding: 12,
          borderRadius: 10,
          alignItems: 'center',
          maxWidth: 260,
          marginTop: 8,
        }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
          Lock Admin
        </Text>
      </Pressable>
    </View>
  );
}
