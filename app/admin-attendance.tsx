import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { supabaseHeaders, supabaseRestUrl } from '@/constants/supabase';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type DivisionGroup = { division: Division; teams: string[] };
type AttendanceMap = Record<string, boolean>; // true = present (green), false = out (red)

const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week';

// ✅ Baseline teams (same as Schedule Builder)
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

type SupabaseTeamRow = {
  id: string;
  created_at: string;
  division: string;
  name: string;
};

type AttendanceRow = {
  id: string;
  week: number;
  team: string;
  present: boolean;
  updated_at: string;
};

function safeInt(value: string, fallback: number) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function uniqSorted(list: string[]) {
  const set = new Set<string>();
  for (const t of list) set.add((t || '').trim());
  return Array.from(set)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function isDivision(v: any): v is Division {
  return v === 'Beginner' || v === 'Intermediate' || v === 'Advanced';
}

async function fetchTeamsFromSupabase(): Promise<Record<Division, SupabaseTeamRow[]>> {
  const url = supabaseRestUrl('teams?select=id,created_at,division,name&order=created_at.asc');

  const res = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase SELECT failed: ${res.status} ${txt}`);
  }

  const rows = (await res.json()) as SupabaseTeamRow[];

  const grouped: Record<Division, SupabaseTeamRow[]> = {
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  };

  for (const r of rows) {
    if (isDivision(r.division)) grouped[r.division].push(r);
  }

  return grouped;
}

async function fetchAttendanceForWeek(week: number): Promise<AttendanceRow[]> {
  const url = supabaseRestUrl(
    `attendance?select=id,week,team,present,updated_at&week=eq.${week}&order=team.asc`
  );

  const res = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Attendance SELECT failed: ${res.status} ${txt}`);
  }

  return (await res.json()) as AttendanceRow[];
}

async function upsertAttendanceRow(week: number, team: string, present: boolean) {
  // Use PostgREST upsert on unique(week, team)
  const url = supabaseRestUrl('attendance?on_conflict=week,team');

  const res = await fetch(url, {
    method: 'POST',
    headers: supabaseHeaders({
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify([{ week, team, present }]),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Attendance UPSERT failed: ${res.status} ${txt}`);
  }
}

export default function AdminAttendanceScreen() {
  const router = useRouter();

  // Week (attendance is week-specific)
  const [week, setWeek] = useState<string>('1');
  const weekNum = safeInt(week, 0);

  // ✅ Teams from Supabase (for newly added teams)
  const [dbTeams, setDbTeams] = useState<Record<Division, SupabaseTeamRow[]>>({
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  });

  const loadTeamsFromSupabase = async () => {
    try {
      const grouped = await fetchTeamsFromSupabase();
      setDbTeams(grouped);
    } catch {
      // still show baseline teams
      setDbTeams({ Advanced: [], Intermediate: [], Beginner: [] });
    }
  };

  const dbTeamNamesByDivision = useMemo(() => {
    return {
      Advanced: uniqSorted((dbTeams.Advanced ?? []).map((r) => r.name)),
      Intermediate: uniqSorted((dbTeams.Intermediate ?? []).map((r) => r.name)),
      Beginner: uniqSorted((dbTeams.Beginner ?? []).map((r) => r.name)),
    };
  }, [dbTeams]);

  // ✅ Division groups: baseline + Supabase teams
  const divisions: DivisionGroup[] = useMemo(() => {
    return [
      {
        division: 'Beginner',
        teams: uniqSorted([...TEAMS_BY_DIVISION.Beginner, ...dbTeamNamesByDivision.Beginner]),
      },
      {
        division: 'Intermediate',
        teams: uniqSorted([...TEAMS_BY_DIVISION.Intermediate, ...dbTeamNamesByDivision.Intermediate]),
      },
      {
        division: 'Advanced',
        teams: uniqSorted([...TEAMS_BY_DIVISION.Advanced, ...dbTeamNamesByDivision.Advanced]),
      },
    ];
  }, [dbTeamNamesByDivision]);

  const allTeamsFlat = useMemo(() => {
    const out: string[] = [];
    for (const d of divisions) {
      for (const t of d.teams) out.push(t);
    }
    return out;
  }, [divisions]);

  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceMap>({});

  // ✅ IMPORTANT: Explicit navigation back into the Tabs area
  const goToAdminDashboard = () => {
    router.replace('/admin' as any);
  };

  // Load current week, and load teams from Supabase once
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
        const n = stored ? safeInt(stored, 0) : 0;
        setWeek(n > 0 ? String(n) : '1');
      } catch {
        setWeek('1');
      }

      await loadTeamsFromSupabase();
    })();
  }, []);

  const loadAttendance = useCallback(
    async (w: number) => {
      if (w <= 0) return;
      setLoading(true);
      try {
        // Pull current week attendance from Supabase
        const rows = await fetchAttendanceForWeek(w);
        const map: AttendanceMap = {};

        for (const r of rows) {
          if (typeof r.team === 'string' && r.team.trim().length > 0) {
            map[r.team] = r.present !== false;
          }
        }

        // Ensure all teams exist (default present=true)
        for (const team of allTeamsFlat) {
          if (typeof map[team] !== 'boolean') map[team] = true;
        }

        setAttendance(map);
      } catch (e: any) {
        const msg = String(e?.message || e);
        Alert.alert('Attendance load failed', msg);
        // Still show teams default present so screen isn't empty
        const fallback: AttendanceMap = {};
        for (const team of allTeamsFlat) fallback[team] = true;
        setAttendance(fallback);
      } finally {
        setLoading(false);
      }
    },
    [allTeamsFlat]
  );

  // Reload attendance when week changes OR teams list changes
  useEffect(() => {
    if (weekNum > 0) void loadAttendance(weekNum);
  }, [weekNum, loadAttendance]);

  const toggleTeam = async (team: string) => {
    if (weekNum <= 0) {
      Alert.alert('Week required', 'Please enter a valid week number first.');
      return;
    }

    const current = attendance[team] !== false;
    const nextPresent = !current;

    // Optimistic UI
    setAttendance((prev) => ({ ...prev, [team]: nextPresent }));

    try {
      await upsertAttendanceRow(weekNum, team, nextPresent);
      // Reload to ensure perfect sync & handle any new teams/rows
      await loadAttendance(weekNum);
    } catch (e: any) {
      // Revert UI on failure
      setAttendance((prev) => ({ ...prev, [team]: current }));
      Alert.alert('Save failed', String(e?.message || e));
    }
  };

  const markAllPresent = async () => {
    if (weekNum <= 0) {
      Alert.alert('Week required', 'Please enter a valid week number first.');
      return;
    }

    try {
      setLoading(true);

      // Upsert present=true for every team
      for (const team of allTeamsFlat) {
        await upsertAttendanceRow(weekNum, team, true);
      }

      await loadAttendance(weekNum);
      Alert.alert('Done', `All teams set to PRESENT for Week ${weekNum}.`);
    } catch (e: any) {
      Alert.alert('Save failed', String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, padding: 24 }}>
      <Pressable
        onPress={goToAdminDashboard}
        style={{
          backgroundColor: '#111',
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 14,
          maxWidth: 260,
        }}
      >
        <Text style={{ color: 'white', fontWeight: '800' }}>Return to Admin Dashboard</Text>
      </Pressable>

      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 8 }}>Attendance</Text>

      <Text style={{ marginBottom: 8 }}>GREEN = present • RED = out</Text>

      <Text style={{ fontWeight: '900', marginBottom: 6, fontSize: 16 }}>
        YOU ARE CURRENTLY MARKING ATTENDANCE FOR WEEK #
      </Text>

      <TextInput
        value={week}
        onChangeText={setWeek}
        keyboardType="number-pad"
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
          fontSize: 28,
          fontWeight: '900',
        }}
      />

      <Pressable
        onPress={markAllPresent}
        style={{
          backgroundColor: '#111',
          padding: 12,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 16,
          maxWidth: 260,
        }}
      >
        <Text style={{ color: 'white', fontWeight: '700' }}>Mark All Present</Text>
      </Pressable>

      {loading ? (
        <Text>Loading…</Text>
      ) : (
        <ScrollView>
          {divisions.map((div) => (
            <View key={div.division} style={{ marginBottom: 18 }}>
              <Text style={{ fontWeight: '900', marginBottom: 8 }}>{div.division}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {div.teams.map((team) => {
                  const isPresent = attendance[team] !== false;
                  return (
                    <Pressable
                      key={team}
                      onPress={() => toggleTeam(team)}
                      style={{
                        backgroundColor: isPresent ? '#1f8a3b' : '#b3261e',
                        padding: 10,
                        borderRadius: 10,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: '800' }}>{team}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
