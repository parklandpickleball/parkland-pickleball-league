import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

const LEAGUE_UNLOCK_KEY = 'ppl_league_unlocked';
const LEAGUE_CODE = 'PPL2026';

export default function LeagueLockScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');

  useEffect(() => {
    const check = async () => {
      const unlocked = await AsyncStorage.getItem(LEAGUE_UNLOCK_KEY);
      if (unlocked === 'true') {
        // ✅ Send to root so tabs context is guaranteed
        router.replace('/');
      }
    };
    void check();
  }, [router]);

  const onUnlock = async () => {
    const cleaned = (code || '').trim();

    if (!cleaned) {
      Alert.alert('Enter code', 'Please enter the league access code.');
      return;
    }

    if (cleaned !== LEAGUE_CODE) {
      Alert.alert('Wrong code', 'That code is not correct.');
      return;
    }

    await AsyncStorage.setItem(LEAGUE_UNLOCK_KEY, 'true');

    // ✅ Always go through root to avoid Unmatched Route during review
    router.replace('/');
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 28, fontWeight: '900', marginBottom: 10 }}>
        Parkland Pickleball League
      </Text>

      <Text style={{ color: '#333', marginBottom: 18, fontWeight: '600' }}>
        Enter the league access code to continue.
      </Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="League access code"
        autoCapitalize="characters"
        autoCorrect={false}
        style={{
          borderWidth: 2,
          borderColor: '#000',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
          marginBottom: 14,
        }}
      />

      <Pressable
        onPress={onUnlock}
        style={{
          backgroundColor: 'black',
          paddingVertical: 14,
          borderRadius: 12,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: 'white', fontWeight: '900', fontSize: 16 }}>
          Unlock
        </Text>
      </Pressable>

      <Text style={{ marginTop: 14, color: '#666' }}>
        If you don’t have the code, contact the league admin.
      </Text>
    </View>
  );
}
