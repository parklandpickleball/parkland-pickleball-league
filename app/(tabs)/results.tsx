import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import { supabaseHeaders, supabaseRestUrl } from '@/constants/supabase';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';
type DivisionFilter = 'ALL' | Division;

type SavedMatch = {
  id: string;
  week: number;
  division: Division;
  time: string;
  court: number;
  teamA: string;
  teamB: string;
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

const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week_v1';

const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

const TIMES: string[] = [
  '6:00 PM','6:15 PM','6:30 PM','6:45 PM',
  '7:00 PM','7:15 PM','7:30 PM','7:45 PM',
  '8:00 PM','8:15 PM','8:30 PM','8:45 PM',
  '9:00 PM','9:15 PM','9:30 PM','9:45 PM',
];

type SupabaseMatchRow = {
  id: string;
  week: number;
  division: string;
  time: string;
  court: number;
  team_a: string;
  team_b: string;
};

type SupabaseMatchScoreRow = {
  match_id: string;
  team_a: any;
  team_b: any;
  verified: boolean;
  verified_by: string | null;
  verified_at_ms: number | null;
};

function isDivision(v: any): v is Division {
  return v === 'Beginner' || v === 'Intermediate' || v === 'Advanced';
}

function safeTrimLower(s: string) {
  return (s ?? '').toString().trim().toLowerCase();
}

function safeInt(value: string, fallback: number) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function asScoreFields(v: any): ScoreFields {
  const g1 = typeof v?.g1 === 'string' ? v.g1 : '';
  const g2 = typeof v?.g2 === 'string' ? v.g2 : '';
  const g3 = typeof v?.g3 === 'string' ? v.g3 : '';
  return { g1, g2, g3 };
}

async function fetchMatchesFromSupabase(): Promise<SavedMatch[]> {
  const url = supabaseRestUrl(
    'matches?select=id,week,division,time,court,team_a,team_b&order=week.asc&order=division.asc&order=time.asc&order=court.asc'
  );

  const res = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase SELECT failed: ${res.status} ${txt}`);
  }

  const rows = (await res.json()) as SupabaseMatchRow[];

  const out: SavedMatch[] = [];
  for (const r of rows) {
    if (!isDivision(r.division)) continue;

    out.push({
      id: String(r.id),
      week: Number(r.week),
      division: r.division,
      time: String(r.time),
      court: Number(r.court),
      teamA: String(r.team_a),
      teamB: String(r.team_b),
    });
  }

  return out;
}

async function fetchMatchScoresFromSupabase(): Promise<Record<string, PersistedMatchScore>> {
  const url = supabaseRestUrl('match_scores?select=match_id,team_a,team_b,verified,verified_by,verified_at_ms');

  const res = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase SELECT failed: ${res.status} ${txt}`);
  }

  const rows = (await res.json()) as SupabaseMatchScoreRow[];

  const out: Record<string, PersistedMatchScore> = {};
  for (const r of rows) {
    const id = String(r.match_id);
    out[id] = {
      matchId: id,
      teamA: asScoreFields(r.team_a),
      teamB: asScoreFields(r.team_b),
      verified: !!r.verified,
      verifiedBy: r.verified_by ?? null,
      verifiedAt: typeof r.verified_at_ms === 'number' ? r.verified_at_ms : null,
    };
  }
  return out;
}

function toN(s: string) {
  const n = parseInt(s || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function totalOf(fields: ScoreFields) {
  return toN(fields.g1) + toN(fields.g2) + toN(fields.g3);
}

// ✅ Results completion logic should match Scoring (empty string = not entered; "0" counts as entered)
function isEnteredScore(v: string) {
  return (v ?? '').trim() !== '';
}
function gameEnteredPair(a: string, b: string) {
  return isEnteredScore(a) && isEnteredScore(b);
}
function enteredGamesCount(teamA: ScoreFields, teamB: ScoreFields) {
  const a = [teamA.g1, teamA.g2, teamA.g3];
  const b = [teamB.g1, teamB.g2, teamB.g3];
  let entered = 0;
  for (let i = 0; i < 3; i++) {
    if (!gameEnteredPair(a[i], b[i])) continue;
    entered += 1;
  }
  return entered;
}

export default function ResultsScreen() {
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [persisted, setPersisted] = useState<Record<string, PersistedMatchScore>>({});

  const [loadError, setLoadError] = useState<string>('');

  // Filters
  const [divisionFilter, setDivisionFilter] = useState<DivisionFilter>('ALL');
  const [weekFilter, setWeekFilter] = useState<string>(''); // '' means not initialized yet
  const [search, setSearch] = useState<string>('');

  const refreshAll = useCallback(async () => {
    setLoadError('');
    try {
      const [m, s] = await Promise.all([
        fetchMatchesFromSupabase(),
        fetchMatchScoresFromSupabase(),
      ]);

      setMatches(Array.isArray(m) ? m : []);
      setPersisted(s && typeof s === 'object' ? s : {});

      // Init week filter (only once)
      if (weekFilter === '') {
        const savedCurrentWeekRaw = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
        const savedCurrentWeek = savedCurrentWeekRaw ? parseInt(String(savedCurrentWeekRaw), 10) : NaN;

        const weeks = Array.from(new Set((m ?? []).map((x) => x.week)))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);

        const newestWeek = weeks.length ? weeks[weeks.length - 1] : 1;

        const initial =
          Number.isFinite(savedCurrentWeek) && savedCurrentWeek > 0
            ? savedCurrentWeek
            : newestWeek;

        setWeekFilter(String(initial));
      }
    } catch (e: any) {
      setMatches([]);
      setPersisted({});
      setLoadError(e?.message || 'Failed to load Results from Supabase.');
    }
  }, [weekFilter]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useFocusEffect(
    useCallback(() => {
      void refreshAll();
    }, [refreshAll])
  );

  const allWeeksSorted = useMemo(() => {
    const weeks = Array.from(new Set(matches.map((m) => m.week)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    return weeks;
  }, [matches]);

  const filteredMatches = useMemo(() => {
    const q = safeTrimLower(search);

    const base = matches.filter((m) => {
      // Division filter
      if (divisionFilter !== 'ALL' && m.division !== divisionFilter) return false;

      // Week filter
      if (weekFilter !== 'ALL' && weekFilter !== '') {
        const w = parseInt(weekFilter, 10);
        if (Number.isFinite(w) && m.week !== w) return false;
      }

      // Search filter (team names)
      if (q) {
        const a = safeTrimLower(m.teamA);
        const b = safeTrimLower(m.teamB);
        if (!a.includes(q) && !b.includes(q)) return false;
      }

      return true;
    });

    // Sort like schedule-ish: division order then week then time then court
    return [...base].sort((a, b) => {
      const da = DIVISION_ORDER.indexOf(a.division);
      const db = DIVISION_ORDER.indexOf(b.division);
      if (da !== db) return da - db;

      if (a.week !== b.week) return a.week - b.week;

      const ta = TIMES.indexOf(a.time);
      const tb = TIMES.indexOf(b.time);
      if (ta !== tb) return ta - tb;

      return a.court - b.court;
    });
  }, [matches, divisionFilter, weekFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<Division, SavedMatch[]>();
    for (const m of filteredMatches) {
      if (!map.has(m.division)) map.set(m.division, []);
      map.get(m.division)!.push(m);
    }
    return DIVISION_ORDER
      .filter((d) => map.has(d))
      .map((division) => ({ division, matches: map.get(division)! }));
  }, [filteredMatches]);

  const showWeekValue = weekFilter === '' ? '1' : weekFilter;

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '900', marginBottom: 6 }}>Results</Text>

      <Text style={{ color: '#444', marginBottom: 12 }}>
        Read-only league results (Supabase matches + saved scores).
      </Text>

      {loadError ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 12 }}>
          Sync warning: {loadError}
        </Text>
      ) : null}

      {/* Division dropdown */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Division</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker
          selectedValue={divisionFilter}
          onValueChange={(v) => setDivisionFilter(String(v) as DivisionFilter)}
        >
          <Picker.Item label="All Divisions" value="ALL" />
          <Picker.Item label="Advanced" value="Advanced" />
          <Picker.Item label="Intermediate" value="Intermediate" />
          <Picker.Item label="Beginner" value="Beginner" />
        </Picker>
      </View>

      {/* Week dropdown */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Week</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker
          selectedValue={showWeekValue}
          onValueChange={(v) => setWeekFilter(String(v))}
        >
          <Picker.Item label="All Weeks" value="ALL" />
          {allWeeksSorted.length === 0 ? (
            <Picker.Item label="Week 1" value="1" />
          ) : (
            allWeeksSorted.map((w) => (
              <Picker.Item key={w} label={`Week ${w}`} value={String(w)} />
            ))
          )}
        </Picker>
      </View>

      {/* Search */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Search</Text>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Type a player or team name (e.g., brandon)"
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderColor: '#ccc',
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
        }}
      />

      {matches.length === 0 ? (
        <Text>No scheduled matches found yet.</Text>
      ) : filteredMatches.length === 0 ? (
        <Text>No matches found for these filters.</Text>
      ) : (
        <View style={{ gap: 18 }}>
          {grouped.map((section) => (
            <View key={section.division}>
              <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 10 }}>
                {section.division}
              </Text>

              <View style={{ gap: 14 }}>
                {section.matches.map((m) => {
                  const p = persisted[m.id];

                  const aFields: ScoreFields = p?.teamA ?? { g1: '', g2: '', g3: '' };
                  const bFields: ScoreFields = p?.teamB ?? { g1: '', g2: '', g3: '' };

                  const aTotal = totalOf(aFields);
                  const bTotal = totalOf(bFields);

                  const enteredGames = p ? enteredGamesCount(aFields, bFields) : 0;

                  const label =
                    enteredGames === 0
                      ? null
                      : enteredGames < 3
                        ? 'PARTIAL'
                        : 'COMPLETED';

                  const labelColor =
                    label === 'COMPLETED' ? 'green' : label === 'PARTIAL' ? 'red' : 'black';

                  const verifiedLabel = p?.verified
                    ? `Verified by ${p.verifiedBy ?? 'UNKNOWN'}`
                    : 'Not verified yet';

                  return (
                    <View
                      key={m.id}
                      style={{
                        borderWidth: 2,
                        borderColor: '#000',
                        borderRadius: 10,
                        overflow: 'hidden',
                        backgroundColor: 'white',
                      }}
                    >
                      <View
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: '#000',
                        }}
                      >
                        <Text style={{ fontWeight: '900' }}>
                          Week {m.week} • {m.time} • Court {m.court}
                        </Text>

                        <Text style={{ marginTop: 4, color: '#333', fontWeight: '700' }}>
                          {verifiedLabel}
                          {label ? (
                            <>
                              {' • '}
                              <Text style={{ color: labelColor, fontWeight: '900' }}>
                                {label}
                              </Text>
                            </>
                          ) : null}
                        </Text>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          borderBottomWidth: 1,
                          borderBottomColor: '#000',
                          paddingVertical: 8,
                          backgroundColor: '#f5f5f5',
                        }}
                      >
                        <Text style={{ width: 110, fontWeight: '900', textAlign: 'center' }}>
                          TIME
                        </Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>
                          COURT #
                        </Text>
                        <Text style={{ flex: 2, fontWeight: '900', textAlign: 'center' }}>
                          TEAM NAME
                        </Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>
                          G1
                        </Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>
                          G2
                        </Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>
                          G3
                        </Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>
                          TOTAL
                        </Text>
                      </View>

                      {/* TEAM A */}
                      <View style={{ flexDirection: 'row', paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ width: 110, textAlign: 'center' }}>{m.time}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{m.court}</Text>
                        <Text style={{ flex: 2, textAlign: 'center' }}>{m.teamA}</Text>

                        <Text style={{ width: 90, textAlign: 'center' }}>{aFields.g1 || '-'}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{aFields.g2 || '-'}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{aFields.g3 || '-'}</Text>

                        <Text style={{ width: 90, textAlign: 'center', fontWeight: '900' }}>
                          {aTotal}
                        </Text>
                      </View>

                      <View style={{ height: 1, backgroundColor: '#000' }} />

                      {/* TEAM B */}
                      <View style={{ flexDirection: 'row', paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ width: 110, textAlign: 'center' }}>{m.time}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{m.court}</Text>
                        <Text style={{ flex: 2, textAlign: 'center' }}>{m.teamB}</Text>

                        <Text style={{ width: 90, textAlign: 'center' }}>{bFields.g1 || '-'}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{bFields.g2 || '-'}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{bFields.g3 || '-'}</Text>

                        <Text style={{ width: 90, textAlign: 'center', fontWeight: '900' }}>
                          {bTotal}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={{ height: 6 }} />
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
