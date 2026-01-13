import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';
const ADMIN_PASSCODE = '2468'; // change this to whatever you want

export default function AdminLockScreen() {
  const router = useRouter();
  const [code, setCode] = useState('');

  useEffect(() => {
    (async () => {
      const unlocked = await AsyncStorage.getItem(ADMIN_UNLOCK_KEY);
      if (unlocked === 'true') {
        router.replace('/admin');
      }
    })();
  }, [router]);

  // ✅ Every time this screen is shown, clear the passcode field
  useFocusEffect(
    useCallback(() => {
      setCode('');
      return () => {
        setCode('');
      };
    }, [])
  );

  const onUnlock = async () => {
    const entered = code.trim();

    if (entered !== ADMIN_PASSCODE) {
      Alert.alert('Wrong code', 'Try again.');
      return;
    }

    await AsyncStorage.setItem(ADMIN_UNLOCK_KEY, 'true');
    setCode(''); // ✅ clear immediately after success
    router.replace('/admin');
  };

  return (
    <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '800', marginBottom: 12 }}>
        Admin Access
      </Text>

      <Text style={{ marginBottom: 16 }}>Enter passcode to continue.</Text>

      <TextInput
        value={code}
        onChangeText={setCode}
        placeholder="Passcode"
        keyboardType="number-pad"
        secureTextEntry
        autoCorrect={false}
        autoCapitalize="none"
        textContentType="oneTimeCode"
        autoComplete="off"
        importantForAutofill="no"
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 10,
          padding: 14,
          fontSize: 18,
          marginBottom: 12,
        }}
      />

      <Pressable
        onPress={onUnlock}
        style={{
          backgroundColor: 'black',
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
        }}
      >
        <Text style={{ color: 'white', fontSize: 18, fontWeight: '700' }}>
          Unlock
        </Text>
      </Pressable>
    </View>
  );
}
