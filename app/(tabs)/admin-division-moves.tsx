import { supabaseHeaders, supabaseRestUrl } from '@/constants/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';
const STORAGE_KEY_DIVISION_MOVES = 'ppl_division_moves_v1';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type DivisionMove = {
  id: string; // local UI id (not Supabase id)
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
    // newest first feels better for admin
    return b.createdAt - a.createdAt;
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
  const [moveTeam, setMoveTeam] = useState<string>('');
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

  // ✅ Always load from Supabase (source of truth)
  const loadMoves = useCallback(async () => {
    try {
      const res = await fetch(
        supabaseRestUrl('/division_moves?select=*&order=created_at.desc'),
        { headers: supabaseHeaders() }
      );
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Load failed', json?.message || 'Unknown error');
        setMoves([]);
        return;
      }

      const rows = Array.isArray(json) ? json : [];

      // Convert supabase rows -> local UI shape
      const list: DivisionMove[] = rows.map((r: any) => ({
        id: String(r.id), // ✅ USE SUPABASE ID so delete works
        team: String(r.team || ''),
        fromDivision: (r.from_division as Division) || 'Beginner',
        toDivision: (r.to_division as Division) || 'Beginner',
        effectiveWeek: Number(r.effective_week ?? r.start_week ?? 1),
        createdAt: new Date(r.created_at).getTime(),
      }));

      const sorted = sortMoves(list);
      setMoves(sorted);
      // keep a local cache too (optional)
      await AsyncStorage.setItem(STORAGE_KEY_DIVISION_MOVES, JSON.stringify(sorted));
    } catch {
      setMoves([]);
    } finally {
      setMovesLoaded(true);
    }
  }, []);

  // ✅ Upsert to Supabase (one row per team, you already have unique index)
  const saveMoveToSupabase = useCallback(
    async (nextMove: { team: string; fromDivision: Division; toDivision: Division; effectiveWeek: number }) => {
      const payload = {
        team: nextMove.team.trim(),
        from_division: nextMove.fromDivision,
        to_division: nextMove.toDivision,
        effective_week: nextMove.effectiveWeek,
      };

      const res = await fetch(
        supabaseRestUrl('/division_moves?on_conflict=team'),
        {
          method: 'POST',
          headers: supabaseHeaders({
            Prefer: 'return=representation,resolution=merge-duplicates',
          }),
          body: JSON.stringify(payload),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        Alert.alert('Save failed', json?.message || 'Unknown error');
        return false;
      }

      return true;
    },
    []
  );

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

    const ok = await saveMoveToSupabase({
      team,
      fromDivision: moveFrom,
      toDivision: moveTo,
      effectiveWeek: wk,
    });

    if (!ok) return;

    // reset inputs
    setMoveTeam('');
    setMoveWeek(String(wk));

    // refresh from Supabase
    await loadMoves();
  };

  const deleteMove = async (id: string) => {
    const target = moves.find((m) => m.id === id);
    if (!target) return;

    const ok = await confirmPopup(
      'Delete division move?',
      `${target.team}\n${target.fromDivision} → ${target.toDivision}\nStarting Week ${target.effectiveWeek}`
    );
    if (!ok) return;

    // ✅ DELETE FROM SUPABASE BY ID (this is the missing piece)
    const res = await fetch(supabaseRestUrl(`/division_moves?id=eq.${id}`), {
      method: 'DELETE',
      headers: supabaseHeaders(),
    });

    Alert.alert('DELETE status', String(res.status));

    if (!res.ok) {
      const j = await res.json().catch(() => null);
      Alert.alert('Delete failed', j?.message || 'Unknown error');
      return;
    }

    await loadMoves();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>Division Moves</Text>

      <Text style={{ marginBottom: 16, color: '#444' }}>
        Choose a team and save a division change. Standings & schedule builder will use Supabase.
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
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '800' }}>Save Division Move</Text>
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
