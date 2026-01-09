import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type SavedMatch = {
  id: string;
  week: number;
  division: Division;
  time: string;
  court: number;
  teamA: string;
  teamB: string;
  createdAt: number;
};

const STORAGE_KEY_MATCHES = 'ppl_matches_v1';
const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week_v1';
const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';

// Order the schedule sections by division (easy to find)
const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

// 6:00 PM → 9:45 PM, every 15 minutes
const TIMES: string[] = [
  '6:00 PM','6:15 PM','6:30 PM','6:45 PM',
  '7:00 PM','7:15 PM','7:30 PM','7:45 PM',
  '8:00 PM','8:15 PM','8:30 PM','8:45 PM',
  '9:00 PM','9:15 PM','9:30 PM','9:45 PM',
];

function sortMatches(list: SavedMatch[]) {
  return [...list].sort((a, b) => {
    const divA = DIVISION_ORDER.indexOf(a.division);
    const divB = DIVISION_ORDER.indexOf(b.division);
    if (divA !== divB) return divA - divB;

    if (a.week !== b.week) return a.week - b.week;

    const timeA = TIMES.indexOf(a.time);
    const timeB = TIMES.indexOf(b.time);
    if (timeA !== timeB) return timeA - timeB;

    return a.court - b.court;
  });
}

export default function ScheduleScreen() {
  const router = useRouter();

  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [currentWeek, setCurrentWeek] = useState<number | null>(null);
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const loadAdmin = useCallback(async () => {
    const unlocked = await AsyncStorage.getItem(ADMIN_UNLOCK_KEY);
    setIsAdmin(unlocked === 'true');
  }, []);

  const loadCurrentWeek = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
    if (!raw) {
      setCurrentWeek(null);
      return;
    }
    const n = parseInt(String(raw), 10);
    setCurrentWeek(Number.isFinite(n) ? n : null);
  }, []);

  const loadMatches = useCallback(async () => {
    setErrorMsg('');
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_MATCHES);
      if (!raw) {
        setMatches([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setMatches([]);
        return;
      }
      setMatches(sortMatches(parsed));
    } catch (e: any) {
      console.error('Schedule load error:', e);
      setErrorMsg(`Could not load schedule: ${String(e?.message ?? e)}`);
      setMatches([]);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await loadAdmin();
    await loadCurrentWeek();
    await loadMatches();
  }, [loadAdmin, loadCurrentWeek, loadMatches]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  const weeksAvailable = useMemo(() => {
    const set = new Set<number>();
    for (const m of matches) set.add(m.week);
    return Array.from(set).sort((a, b) => a - b);
  }, [matches]);

  // Default selectedWeek:
  // 1) if currentWeek exists and is in schedule -> use it
  // 2) else -> first available week
  useEffect(() => {
    if (selectedWeek !== null) return;

    if (weeksAvailable.length === 0) {
      setSelectedWeek(null);
      return;
    }

    if (currentWeek !== null && weeksAvailable.includes(currentWeek)) {
      setSelectedWeek(currentWeek);
      return;
    }

    setSelectedWeek(weeksAvailable[0]);
  }, [weeksAvailable, currentWeek, selectedWeek]);

  const filteredMatches = useMemo(() => {
    if (selectedWeek === null) return [];
    return matches.filter((m) => m.week === selectedWeek);
  }, [matches, selectedWeek]);

  const grouped = useMemo(() => {
    // Division -> Time -> Matches[]
    const divMap = new Map<Division, Map<string, SavedMatch[]>>();

    for (const m of filteredMatches) {
      if (!divMap.has(m.division)) divMap.set(m.division, new Map());
      const timeMap = divMap.get(m.division)!;

      if (!timeMap.has(m.time)) timeMap.set(m.time, []);
      timeMap.get(m.time)!.push(m);
    }

    const divisions = DIVISION_ORDER
      .filter((d) => divMap.has(d))
      .map((d) => {
        const timeMap = divMap.get(d)!;

        const times = Array.from(timeMap.keys())
          .sort((a, b) => TIMES.indexOf(a) - TIMES.indexOf(b))
          .map((time) => {
            const items = [...(timeMap.get(time) ?? [])].sort((x, y) => x.court - y.court);
            return { time, items };
          });

        return { division: d, times };
      });

    return divisions;
  }, [filteredMatches]);

  const setAsCurrentWeek = useCallback(async () => {
    if (!isAdmin) return;
    if (selectedWeek === null) return;

    await AsyncStorage.setItem(STORAGE_KEY_CURRENT_WEEK, String(selectedWeek));
    setCurrentWeek(selectedWeek);
  }, [isAdmin, selectedWeek]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      {/* HEADER ROW */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontSize: 24, fontWeight: '900', flex: 1 }}>
          Schedule
        </Text>

        <Pressable
          onPress={loadMatches}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: '#ccc',
          }}
        >
          <Text style={{ fontWeight: '800' }}>Refresh</Text>
        </Pressable>
      </View>

      {/* ADMIN BUTTON (back on Schedule tab) */}
      {isAdmin ? (
        <View style={{ marginBottom: 12 }}>
          <Pressable
            onPress={() => router.push('/admin-schedule')}
            style={{
              backgroundColor: 'black',
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '900' }}>Admin: Edit Schedule</Text>
          </Pressable>
        </View>
      ) : null}

      {/* WEEK FILTER ROW */}
      <View
        style={{
          borderWidth: 1,
          borderColor: '#ddd',
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          backgroundColor: 'white',
        }}
      >
        <Text style={{ fontWeight: '900', marginBottom: 8 }}>
          Week
        </Text>

        {weeksAvailable.length === 0 ? (
          <Text>No weeks found yet.</Text>
        ) : (
          <View
            style={{
              borderWidth: 1,
              borderColor: '#ccc',
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: 'white',
            }}
          >
            <Picker
              selectedValue={selectedWeek ?? weeksAvailable[0]}
              onValueChange={(val) => setSelectedWeek(Number(val))}
            >
              {weeksAvailable.map((w) => (
                <Picker.Item key={`week-${w}`} label={`Week ${w}`} value={w} />
              ))}
            </Picker>
          </View>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10 }}>
          <Text style={{ fontWeight: '800' }}>
            Current Week: {currentWeek ?? 'Not set'}
          </Text>

          {isAdmin ? (
            <Pressable
              onPress={() => { void setAsCurrentWeek(); }}
              style={{
                backgroundColor: 'black',
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
              }}
              disabled={selectedWeek === null}
            >
              <Text style={{ color: 'white', fontWeight: '900' }}>
                Set as Current Week
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* ERROR */}
      {errorMsg ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: '#c62828',
            backgroundColor: '#ffebee',
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: '800' }}>⚠️ {errorMsg}</Text>
        </View>
      ) : null}

      {/* EMPTY */}
      {filteredMatches.length === 0 ? (
        <Text>No matches found for this week.</Text>
      ) : (
        <View style={{ gap: 18 }}>
          {grouped.map((divSection) => (
            <View key={divSection.division}>
              {/* DIVISION HEADER */}
              <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 10 }}>
                {divSection.division}
              </Text>

              <View style={{ gap: 14 }}>
                {divSection.times.map((timeSection) => (
                  <View
                    key={`${divSection.division}-week-${selectedWeek}-time-${timeSection.time}`}
                    style={{
                      borderWidth: 1,
                      borderColor: '#ddd',
                      borderRadius: 14,
                      padding: 14,
                    }}
                  >
                    <Text style={{ fontSize: 16, fontWeight: '900', marginBottom: 10 }}>
                      Week {selectedWeek} • {timeSection.time}
                    </Text>

                    {/* TABLE HEADER ROW */}
                    <View
                      style={{
                        flexDirection: 'row',
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderWidth: 1,
                        borderColor: '#eee',
                        borderRadius: 12,
                        backgroundColor: '#fafafa',
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ width: 90, fontWeight: '900' }}>Court</Text>
                      <Text style={{ flex: 1, fontWeight: '900' }}>Match</Text>
                    </View>

                    {/* COURT ROWS */}
                    <View style={{ borderWidth: 1, borderColor: '#eee', borderRadius: 12, overflow: 'hidden' }}>
                      {timeSection.items.map((m, idx) => (
                        <View
                          key={m.id}
                          style={{
                            flexDirection: 'row',
                            paddingVertical: 10,
                            paddingHorizontal: 10,
                            borderTopWidth: idx === 0 ? 0 : 1,
                            borderTopColor: '#eee',
                            backgroundColor: 'white',
                          }}
                        >
                          <Text style={{ width: 90, fontWeight: '800' }}>
                            {m.court}
                          </Text>
                          <Text style={{ flex: 1 }}>
                            {m.teamA} vs {m.teamB}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>

              <View style={{ height: 18 }} />
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
