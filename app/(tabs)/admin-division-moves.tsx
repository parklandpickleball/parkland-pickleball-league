import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';
const STORAGE_KEY_DIVISION_MOVES = 'ppl_division_moves_v1';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type DivisionMove = {
  id: string;
  team: string;
  fromDivision: Division;
  toDivision: Division;
  effectiveWeek: number;
  createdAt: number;
};

const TEAMS_BY_DIVISION: Record<Division, string[]> = {
  Advanced: [
    'Ishai/Greg',
    'Adam/Jon',
    'Bradley/Ben',
    'Peter/Ray',
    'Andrew/Brent',
    'Mark D/Craig',
    'Alex/Anibal',
    'Radek/Alexi',
    'Ricky/John',
    'Brandon/Ikewa',
    'Andrew/Dan',
    'Eric/Meir',
    'David/Guy',
    'Mark P/Matt O',
  ],
  Intermediate: [
    'Ashley/Julie',
    'Stephanie/Misty',
    'Eric/Sunil',
    'Dan/Relu',
    'Domencio/Keith',
    'YG/Haaris',
    'Nicole/Joshua',
    'Amy/Nik',
    'Elaine/Valerie',
    'Marat/Marta',
    'Beatriz/Joe',
    'Alejandro/William',
  ],
  Beginner: [
    'Eric/Tracy',
    'Rachel/Jaime',
    'Amy/Ellen',
    'Lashonda/Lynette',
    'Michael/JP',
    'Fran/Scott',
    'Robert/Adam',
    'Cynthia/Maureen',
    'Marina/Sharon',
  ],
};

function safeInt(value: string, fallback: number) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sortMoves(list: DivisionMove[]) {
  return [...list].sort((a, b) => {
    if (a.effectiveWeek !== b.effectiveWeek) return a.effectiveWeek - b.effectiveWeek;
    if (a.toDivision !== b.toDivision) return a.toDivision.localeCompare(b.toDivision);
    return a.createdAt - b.createdAt;
  });
}

// ✅ confirm helper that works on web + native
function confirmPopup(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' ? window.confirm(`${title}\n\n${message}`) : false;
    return Promise.resolve(ok);
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

export default function AdminDivisionMovesScreen() {
  const router = useRouter();

  const [moves, setMoves] = useState<DivisionMove[]>([]);
  const [movesLoaded, setMovesLoaded] = useState(false);

  // ✅ Team dropdown value (no typing)
  const [moveTeam, setMoveTeam] = useState<string>(''); // empty = not chosen yet

  const [moveFrom, setMoveFrom] = useState<Division>('Intermediate');
  const [moveTo, setMoveTo] = useState<Division>('Advanced');
  const [moveWeek, setMoveWeek] = useState<string>('1');

  const allTeams = useMemo(() => {
    const set = new Set<string>();
    (Object.keys(TEAMS_BY_DIVISION) as Division[]).forEach((d) => {
      TEAMS_BY_DIVISION[d].forEach((t) => set.add(t));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, []);

  const loadMoves = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_DIVISION_MOVES);
      const parsed = raw ? JSON.parse(raw) : [];
      const list: DivisionMove[] = Array.isArray(parsed) ? parsed : [];
      setMoves(sortMoves(list));
    } catch {
      setMoves([]);
    } finally {
      setMovesLoaded(true);
    }
  }, []);

  const persistMoves = useCallback(async (next: DivisionMove[]) => {
    const sorted = sortMoves(next);
    setMoves(sorted);
    await AsyncStorage.setItem(STORAGE_KEY_DIVISION_MOVES, JSON.stringify(sorted));
  }, []);

  // ✅ Guard screen + load data each time you open it
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const unlocked = await AsyncStorage.getItem(ADMIN_UNLOCK_KEY);
        if (unlocked !== 'true') {
          router.replace('/admin-lock');
          return;
        }
        await loadMoves();
      })();
    }, [router, loadMoves])
  );

  const addMove = async () => {
    const team = moveTeam.trim();
    const wk = safeInt(moveWeek, 0);

    if (!team) {
      Alert.alert('Missing team', 'Please choose a team from the dropdown.');
      return;
    }
    if (wk <= 0) {
      Alert.alert('Invalid week', 'Effective week must be 1 or higher.');
      return;
    }
    if (moveFrom === moveTo) {
      Alert.alert('Invalid move', 'From Division and To Division must be different.');
      return;
    }

    const newMove: DivisionMove = {
      id: uid(),
      team,
      fromDivision: moveFrom,
      toDivision: moveTo,
      effectiveWeek: wk,
      createdAt: Date.now(),
    };

    await persistMoves([...moves, newMove]);

    // Reset just the inputs you’ll want reset
    setMoveTeam('');
    setMoveWeek(String(wk));
  };

  const deleteMove = async (id: string) => {
    const target = moves.find((m) => m.id === id);
    if (!target) return;

    const ok = await confirmPopup(
      'Delete division move?',
      `${target.team}\n${target.fromDivision} → ${target.toDivision}\nStarting Week ${target.effectiveWeek}`
    );
    if (!ok) return;

    await persistMoves(moves.filter((m) => m.id !== id));
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>
        Division Moves
      </Text>

      <Text style={{ marginBottom: 16, color: '#444' }}>
        Choose a team and save a division change. Standings will use this saved data.
      </Text>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Team</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 10 }}>
        <Picker selectedValue={moveTeam} onValueChange={(v) => setMoveTeam(String(v))}>
          <Picker.Item label="Select a team..." value="" />
          {allTeams.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>From Division</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 10 }}>
        <Picker selectedValue={moveFrom} onValueChange={(v) => setMoveFrom(v as Division)}>
          <Picker.Item label="Beginner" value="Beginner" />
          <Picker.Item label="Intermediate" value="Intermediate" />
          <Picker.Item label="Advanced" value="Advanced" />
        </Picker>
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>To Division</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 10 }}>
        <Picker selectedValue={moveTo} onValueChange={(v) => setMoveTo(v as Division)}>
          <Picker.Item label="Beginner" value="Beginner" />
          <Picker.Item label="Intermediate" value="Intermediate" />
          <Picker.Item label="Advanced" value="Advanced" />
        </Picker>
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Effective Week (starting week)</Text>
      <TextInput
        value={moveWeek}
        onChangeText={setMoveWeek}
        keyboardType="number-pad"
        placeholder="e.g. 5"
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 10,
          padding: 12,
          marginBottom: 10,
          fontSize: 16,
        }}
      />

      <Pressable
        onPress={addMove}
        style={{
          backgroundColor: '#111',
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 14,
        }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '800' }}>
          Save Division Move
        </Text>
      </Pressable>

      <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 8 }}>Saved Moves</Text>

      {!movesLoaded ? (
        <Text>Loading…</Text>
      ) : moves.length === 0 ? (
        <Text style={{ color: '#555' }}>No division moves saved.</Text>
      ) : (
        moves.map((m) => (
          <View
            key={m.id}
            style={{
              borderWidth: 1,
              borderColor: '#e5e5e5',
              borderRadius: 12,
              padding: 10,
              marginBottom: 10,
            }}
          >
            <Text style={{ fontWeight: '900' }}>{m.team}</Text>
            <Text style={{ marginTop: 2 }}>
              {m.fromDivision} → {m.toDivision} starting Week {m.effectiveWeek}
            </Text>

            <Pressable
              onPress={() => void deleteMove(m.id)}
              style={{
                marginTop: 10,
                alignSelf: 'flex-start',
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: '#c62828',
              }}
            >
              <Text style={{ color: 'white', fontWeight: '900' }}>Delete</Text>
            </Pressable>
          </View>
        ))
      )}

      <Pressable
        onPress={() => router.back()}
        style={{
          marginTop: 10,
          borderWidth: 1,
          borderColor: '#999',
          padding: 12,
          borderRadius: 10,
          alignItems: 'center',
          maxWidth: 260,
        }}
      >
        <Text style={{ fontWeight: '900' }}>Back</Text>
      </Pressable>
    </ScrollView>
  );
}
