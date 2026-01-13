import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { supabaseHeaders, supabaseRestUrl } from '@/constants/supabase';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type SavedMatch = {
  id: string;
  week: number;
  division: Division;
  time: string;
  court: number;
  teamA: string;
  teamB: string;
  createdAt?: number;
};

type ScoreFields = { g1: string; g2: string; g3: string };

type PersistedMatchScore = {
  matchId: string;
  teamA: ScoreFields;
  teamB: ScoreFields;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: number | null;
};

// --- Storage keys used across your app ---
const STORAGE_KEY_MATCHES = 'ppl_matches_v1';
const STORAGE_KEY_SCORES = 'ppl_scores_v1';
const STORAGE_KEY_DIVISION_MOVES = 'ppl_division_moves_v1';
const ATTENDANCE_KEY_PREFIX = 'ppl_team_attendance_week_v1_';

// ✅ LEGACY (old local teams list) — we will clear this so Schedule Builder stops showing old deleted teams like "b/b"
const LEGACY_STORAGE_KEY_TEAMS = 'ppl_teams_by_division_v1';

// --- Default teams (baseline) ---
const DEFAULT_TEAMS_BY_DIVISION: Record<Division, string[]> = {
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

function normalizeName(s: string) {
  return (s || '').trim();
}

function uniqSorted(list: string[]) {
  const set = new Set(list.map((x) => x.trim()).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function safeGetJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

async function safeSetJSON(key: string, value: any) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
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
    if (isDivision(r.division)) {
      grouped[r.division].push(r);
    }
  }

  return grouped;
}

async function insertTeamToSupabase(division: Division, name: string) {
  const url = supabaseRestUrl('teams');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'return=representation',
    },
    body: JSON.stringify([{ division, name }]),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase INSERT failed: ${res.status} ${txt}`);
  }
}

async function deleteTeamFromSupabaseById(id: string) {
  const url = supabaseRestUrl(`teams?id=eq.${encodeURIComponent(id)}`);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase DELETE failed: ${res.status} ${txt}`);
  }
}

export default function AdminTeamsScreen() {
  const [division, setDivision] = useState<Division>('Intermediate');
  const [teamName, setTeamName] = useState('');

  const [dbTeams, setDbTeams] = useState<Record<Division, SupabaseTeamRow[]>>({
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  });

  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Delete UI
  const [showDeleteBox, setShowDeleteBox] = useState(false);
  const [deleteTeamName, setDeleteTeamName] = useState<string>('');
  const [deleteTeamId, setDeleteTeamId] = useState<string>('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const refreshTeams = async () => {
    setError('');
    setStatus('');
    setLoading(true);
    try {
      const grouped = await fetchTeamsFromSupabase();
      setDbTeams(grouped);
    } catch (e: any) {
      setError(e?.message || 'Failed to load teams from Supabase.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      // ✅ One-time cleanup: remove old locally-saved teams list so legacy teams like "b/b" stop appearing in Schedule Builder
      try {
        await AsyncStorage.removeItem(LEGACY_STORAGE_KEY_TEAMS);
      } catch {}

      await refreshTeams();
    })();
  }, []);

  const dbTeamsByDivisionNames = useMemo(() => {
    return {
      Advanced: uniqSorted((dbTeams.Advanced ?? []).map((r) => r.name)),
      Intermediate: uniqSorted((dbTeams.Intermediate ?? []).map((r) => r.name)),
      Beginner: uniqSorted((dbTeams.Beginner ?? []).map((r) => r.name)),
    };
  }, [dbTeams]);

  const mergedTeamsByDivision = useMemo(() => {
    return {
      Advanced: uniqSorted([...DEFAULT_TEAMS_BY_DIVISION.Advanced, ...dbTeamsByDivisionNames.Advanced]),
      Intermediate: uniqSorted([
        ...DEFAULT_TEAMS_BY_DIVISION.Intermediate,
        ...dbTeamsByDivisionNames.Intermediate,
      ]),
      Beginner: uniqSorted([...DEFAULT_TEAMS_BY_DIVISION.Beginner, ...dbTeamsByDivisionNames.Beginner]),
    };
  }, [dbTeamsByDivisionNames]);

  const teamsInThisDivision = mergedTeamsByDivision[division];

  const deletableNameToRow = useMemo(() => {
    const map = new Map<string, SupabaseTeamRow>();
    for (const row of dbTeams[division] ?? []) {
      map.set(row.name, row);
    }
    return map;
  }, [dbTeams, division]);

  const onAddTeam = async () => {
    setStatus('');
    setError('');

    const name = normalizeName(teamName);
    if (!name) {
      setError('Enter a team name.');
      return;
    }

    const allTeams = new Set<string>([
      ...mergedTeamsByDivision.Advanced,
      ...mergedTeamsByDivision.Intermediate,
      ...mergedTeamsByDivision.Beginner,
    ]);

    if (allTeams.has(name)) {
      setError('That team already exists.');
      return;
    }

    setLoading(true);
    try {
      await insertTeamToSupabase(division, name);
      setTeamName('');
      setStatus(`✅ Added "${name}" to ${division}.`);
      await refreshTeams();
    } catch (e: any) {
      setError(e?.message || 'Failed to add team to Supabase.');
    } finally {
      setLoading(false);
    }
  };

  const openDelete = (name: string) => {
    setStatus('');
    setError('');

    const row = deletableNameToRow.get(name);
    if (!row) {
      setError('Only teams you added (stored in Supabase) can be deleted.');
      return;
    }

    setShowDeleteBox(true);
    setDeleteTeamName(name);
    setDeleteTeamId(row.id);
    setDeleteConfirmText('');
  };

  const cancelDelete = () => {
    setShowDeleteBox(false);
    setDeleteTeamName('');
    setDeleteTeamId('');
    setDeleteConfirmText('');
  };

  const confirmDelete = async () => {
    setStatus('');
    setError('');

    const name = normalizeName(deleteTeamName);
    const id = normalizeName(deleteTeamId);

    if (!name || !id) {
      setError('Pick a team to delete.');
      return;
    }

    if (deleteConfirmText.trim() !== 'Delete') {
      setError('To confirm, type exactly: Delete');
      return;
    }

    setLoading(true);
    try {
      await deleteTeamFromSupabaseById(id);

      const matches = await safeGetJSON<SavedMatch[]>(STORAGE_KEY_MATCHES, []);
      const scores = await safeGetJSON<Record<string, PersistedMatchScore>>(STORAGE_KEY_SCORES, {});

      const matchesToRemove = matches.filter((m) => m.teamA === name || m.teamB === name);
      const remainingMatches = matches.filter((m) => !(m.teamA === name || m.teamB === name));

      const removedScoreIds = new Set(matchesToRemove.map((m) => m.id));
      const nextScores: Record<string, PersistedMatchScore> = {};
      for (const [matchId, scoreObj] of Object.entries(scores)) {
        if (removedScoreIds.has(matchId)) continue;
        nextScores[matchId] = scoreObj;
      }

      const moves = await safeGetJSON<any[]>(STORAGE_KEY_DIVISION_MOVES, []);
      const remainingMoves = Array.isArray(moves) ? moves.filter((m) => (m?.team ?? '') !== name) : [];

      await safeSetJSON(STORAGE_KEY_MATCHES, remainingMatches);
      await safeSetJSON(STORAGE_KEY_SCORES, nextScores);
      await safeSetJSON(STORAGE_KEY_DIVISION_MOVES, remainingMoves);

      const weeks = uniqSorted(matchesToRemove.map((m) => String(m.week))).map((x) => parseInt(x, 10));
      for (const w of weeks) {
        if (!Number.isFinite(w) || w <= 0) continue;
        const key = `${ATTENDANCE_KEY_PREFIX}${w}`;
        const att = await safeGetJSON<Record<string, boolean>>(key, {});
        if (att && typeof att === 'object' && name in att) {
          const copy = { ...att };
          delete copy[name];
          await safeSetJSON(key, copy);
        }
      }

      setShowDeleteBox(false);
      setDeleteTeamName('');
      setDeleteTeamId('');
      setDeleteConfirmText('');

      setStatus(
        `🗑️ Deleted "${name}". Removed ${matchesToRemove.length} match(es) and ${removedScoreIds.size} score record(s).`
      );

      await refreshTeams();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete team.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 26, fontWeight: '900', marginBottom: 6 }}>Admin — Manage Teams</Text>

      <Text style={{ color: '#444', marginBottom: 16 }}>
        Add a team mid-season (stored in Supabase), or delete a team you added (deleting also removes any
        local matches/scores involving that team).
      </Text>

      {loading ? (
        <Text style={{ color: '#444', fontWeight: '900', marginBottom: 10 }}>Loading…</Text>
      ) : null}

      {status ? (
        <Text style={{ color: 'green', fontWeight: '900', marginBottom: 10 }}>{status}</Text>
      ) : null}
      {error ? (
        <Text style={{ color: 'red', fontWeight: '900', marginBottom: 10 }}>{error}</Text>
      ) : null}

      <Text style={{ fontWeight: '900', marginBottom: 6 }}>Division</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={division} onValueChange={(v) => setDivision(v as Division)}>
          <Picker.Item label="Advanced" value="Advanced" />
          <Picker.Item label="Intermediate" value="Intermediate" />
          <Picker.Item label="Beginner" value="Beginner" />
        </Picker>
      </View>

      <Text style={{ fontWeight: '900', marginBottom: 6 }}>Add Team</Text>
      <TextInput
        value={teamName}
        onChangeText={setTeamName}
        placeholder='e.g. "Chris/Mike"'
        autoCapitalize="none"
        autoCorrect={false}
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
        onPress={onAddTeam}
        disabled={loading}
        style={{
          backgroundColor: 'black',
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 18,
          opacity: loading ? 0.6 : 1,
        }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '900' }}>Add Team</Text>
      </Pressable>

      <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 10 }}>
        Teams in {division}
      </Text>

      <View style={{ gap: 10, marginBottom: 16 }}>
        {teamsInThisDivision.map((t) => {
          const canDelete = deletableNameToRow.has(t);

          return (
            <View
              key={t}
              style={{
                borderWidth: 1,
                borderColor: '#ddd',
                borderRadius: 12,
                padding: 12,
                backgroundColor: 'white',
              }}
            >
              <Text style={{ fontWeight: '900', fontSize: 16, marginBottom: 8 }}>{t}</Text>

              {canDelete ? (
                <Pressable
                  onPress={() => openDelete(t)}
                  style={{
                    backgroundColor: '#c62828',
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: '900' }}>Delete Team</Text>
                </Pressable>
              ) : (
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: '#ddd',
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontWeight: '900', color: '#666' }}>Baseline team</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {showDeleteBox ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: '#c62828',
            borderRadius: 12,
            padding: 12,
            marginTop: 6,
          }}
        >
          <Text style={{ fontWeight: '900', fontSize: 16, marginBottom: 6 }}>Confirm Delete</Text>

          <Text style={{ marginBottom: 10 }}>
            You are deleting: <Text style={{ fontWeight: '900' }}>{deleteTeamName}</Text>
            {'\n\n'}
            This will delete the team from Supabase AND remove any local matches/scores involving this team.
            {'\n\n'}
            Type exactly <Text style={{ fontWeight: '900' }}>Delete</Text> to confirm.
          </Text>

          <TextInput
            value={deleteConfirmText}
            onChangeText={setDeleteConfirmText}
            placeholder="Type Delete"
            autoCapitalize="none"
            autoCorrect={false}
            style={{
              borderWidth: 1,
              borderColor: '#ccc',
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
            }}
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={confirmDelete}
              disabled={loading || deleteConfirmText.trim() !== 'Delete'}
              style={{
                backgroundColor: !loading && deleteConfirmText.trim() === 'Delete' ? '#c62828' : '#999',
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                flex: 1,
                opacity: !loading && deleteConfirmText.trim() === 'Delete' ? 1 : 0.5,
              }}
            >
              <Text style={{ color: 'white', fontWeight: '900' }}>{loading ? 'Deleting…' : 'Delete'}</Text>
            </Pressable>

            <Pressable
              onPress={cancelDelete}
              disabled={loading}
              style={{
                borderWidth: 1,
                borderColor: '#999',
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                flex: 1,
                opacity: loading ? 0.6 : 1,
              }}
            >
              <Text style={{ fontWeight: '900' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={{ height: 20 }} />
    </ScrollView>
  );
}
