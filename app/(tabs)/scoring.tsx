import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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
};

const STORAGE_KEY_SELECTED_TEAM = 'ppl_selected_team';
const STORAGE_KEY_SELECTED_PLAYER_NAME = 'ppl_selected_player_name';
const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';
const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week_v1';

type ScoreFields = { g1: string; g2: string; g3: string };

type PersistedMatchScore = {
  matchId: string;
  teamA: ScoreFields;
  teamB: ScoreFields;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: number | null; // ✅ local-only (NOT stored in Supabase right now)
};

const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

const TIMES: string[] = [
  '6:00 PM','6:15 PM','6:30 PM','6:45 PM',
  '7:00 PM','7:15 PM','7:30 PM','7:45 PM',
  '8:00 PM','8:15 PM','8:30 PM','8:45 PM',
  '9:00 PM','9:15 PM','9:30 PM','9:45 PM',
];

// ✅ Baseline teams (same baseline approach as Admin Teams)
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

type SupabaseMatchRow = {
  id: string;
  week: number;
  division: string;
  time: string;
  court: number;
  team_a: string;
  team_b: string;
  created_at_ms?: number | null;
};

type SupabaseMatchScoreRow = {
  match_id: string;
  team_a: any;
  team_b: any;
  verified: boolean;
  verified_by: string | null;
  // ✅ DO NOT include verified_at / verified_at_ms here because your table doesn't have it
};

function normalizeName(s: string) {
  return (s || '').trim();
}

function uniqSorted(list: string[]) {
  const set = new Set(list.map((x) => normalizeName(x)).filter(Boolean));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
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

async function fetchMatchesFromSupabase(): Promise<SavedMatch[]> {
  const url = supabaseRestUrl(
    'matches?select=id,week,division,time,court,team_a,team_b,created_at_ms&order=week.asc&order=division.asc&order=time.asc&order=court.asc'
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

function asScoreFields(v: any): ScoreFields {
  const g1 = typeof v?.g1 === 'string' ? v.g1 : '';
  const g2 = typeof v?.g2 === 'string' ? v.g2 : '';
  const g3 = typeof v?.g3 === 'string' ? v.g3 : '';
  return { g1, g2, g3 };
}

async function fetchMatchScoresFromSupabase(): Promise<Record<string, PersistedMatchScore>> {
  // ✅ FIX: remove verified_at/verified_at_ms from select because your table doesn't have it
  const url = supabaseRestUrl('match_scores?select=match_id,team_a,team_b,verified,verified_by');

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
      verifiedAt: null, // ✅ no DB column for this right now
    };
  }
  return out;
}

async function upsertMatchScoreToSupabase(row: PersistedMatchScore) {
  const url = supabaseRestUrl('match_scores');

  // ✅ FIX: remove verified_at/verified_at_ms from payload because your table doesn't have it
  const payload = {
    match_id: row.matchId,
    team_a: row.teamA,
    team_b: row.teamB,
    verified: row.verified,
    verified_by: row.verifiedBy,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase UPSERT failed: ${res.status} ${txt}`);
  }
}

function sanitizeAndClampScore(input: string) {
  const digits = (input ?? '').replace(/[^\d]/g, '');
  if (digits === '') return '';
  const two = digits.length <= 2 ? digits : digits.slice(0, 2);
  const n = parseInt(two, 10);
  if (!Number.isFinite(n)) return '';
  if (n > 11) return '11';
  if (n < 0) return '0';
  return String(n);
}

function getTeamKey(matchId: string, team: string) {
  return `${matchId}__${team}`;
}

type ScoreInputProps = {
  initialValue: string;
  onChange: (next: string) => void;
  editable: boolean;
};

const ScoreInput = memo(function ScoreInput({ initialValue, onChange, editable }: ScoreInputProps) {
  const [local, setLocal] = useState(initialValue ?? '');

  useEffect(() => {
    setLocal(initialValue ?? '');
  }, [initialValue]);

  return (
    <TextInput
      value={local}
      onChangeText={(t) => {
        if (!editable) return;
        const next = sanitizeAndClampScore(t);
        setLocal(next);
        onChange(next);
      }}
      editable={editable}
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={2}
      blurOnSubmit={false}
      enterKeyHint="done"
      style={{
        flex: 1,
        borderWidth: 1,
        borderColor: editable ? '#ccc' : '#e0e0e0',
        paddingVertical: Platform.OS === 'web' ? 8 : 6,
        textAlign: 'center',
        marginHorizontal: 4,
        borderRadius: 6,
        backgroundColor: editable ? 'white' : '#f2f2f2',
        color: 'black',
      }}
      placeholder="-"
    />
  );
});

function toN(s: string) {
  const n = parseInt(s || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function totalOf(fields: ScoreFields) {
  return toN(fields.g1) + toN(fields.g2) + toN(fields.g3);
}

/**
 * ✅ IMPORTANT: a score is considered "entered" if the string is NOT empty.
 * This allows legitimate scores like "0" to count as entered.
 */
function isEnteredScore(v: string) {
  return (v ?? '').trim() !== '';
}

/**
 * ✅ IMPORTANT: a game is considered entered ONLY when BOTH teams have a score.
 * This prevents "blank treated as 0" from accidentally counting as entered.
 */
function gameEnteredPair(a: string, b: string) {
  return isEnteredScore(a) && isEnteredScore(b);
}

function gameWins(teamA: ScoreFields, teamB: ScoreFields) {
  const aRaw = [teamA.g1, teamA.g2, teamA.g3];
  const bRaw = [teamB.g1, teamB.g2, teamB.g3];

  let aWins = 0;
  let bWins = 0;
  let gamesEntered = 0;

  for (let i = 0; i < 3; i++) {
    if (!gameEnteredPair(aRaw[i], bRaw[i])) continue;

    gamesEntered += 1;
    const a = toN(aRaw[i]);
    const b = toN(bRaw[i]);

    if (a > b) aWins += 1;
    else if (b > a) bWins += 1;
  }

  return { aWins, bWins, gamesEntered };
}

function statusLine(teamAName: string, teamBName: string, teamA: ScoreFields, teamB: ScoreFields) {
  const { aWins, bWins, gamesEntered } = gameWins(teamA, teamB);
  const aTotal = totalOf(teamA);
  const bTotal = totalOf(teamB);

  const anyEntered =
    isEnteredScore(teamA.g1) || isEnteredScore(teamA.g2) || isEnteredScore(teamA.g3) ||
    isEnteredScore(teamB.g1) || isEnteredScore(teamB.g2) || isEnteredScore(teamB.g3);

  if (!anyEntered) return null;

  const denom = gamesEntered;
  const parts: string[] = [];

  if (gamesEntered < 3) {
    parts.push(`${teamAName} won ${aWins} of ${denom} entered games • ${teamBName} won ${bWins} of ${denom} entered games`);
  } else {
    parts.push(`${teamAName} won ${aWins} of 3 games • ${teamBName} won ${bWins} of 3 games`);
  }

  if (aTotal !== bTotal) {
    parts.push(bTotal > aTotal ? `${teamBName} outscored ${teamAName}` : `${teamAName} outscored ${teamBName}`);
  } else {
    parts.push(`Total points tied`);
  }

  return parts.join(' • ');
}

/**
 * ✅ COMPLETION must be based ONLY on PERSISTED (saved) values.
 */
function persistedCompletionLabel(p?: PersistedMatchScore) {
  if (!p) return null as null | 'PARTIAL' | 'COMPLETED';

  const entered1 = gameEnteredPair(p.teamA.g1, p.teamB.g1);
  const entered2 = gameEnteredPair(p.teamA.g2, p.teamB.g2);
  const entered3 = gameEnteredPair(p.teamA.g3, p.teamB.g3);

  const enteredCount = [entered1, entered2, entered3].filter(Boolean).length;

  if (enteredCount === 0) return null;
  if (enteredCount === 3) return 'COMPLETED';
  return 'PARTIAL';
}

function safeInt(value: string, fallback: number) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export default function ScoringScreen() {
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [myTeam, setMyTeam] = useState<string | null>(null);
  const [myPlayerName, setMyPlayerName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  // Draft edits (local only)
  const [scores, setScores] = useState<Record<string, ScoreFields>>({});
  // ✅ Persisted scores now come from Supabase
  const [persisted, setPersisted] = useState<Record<string, PersistedMatchScore>>({});

  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [adminPartialOnly, setAdminPartialOnly] = useState<boolean>(false);

  const [dbTeams, setDbTeams] = useState<Record<Division, SupabaseTeamRow[]>>({
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  });

  const [teamsLoadError, setTeamsLoadError] = useState<string>('');
  const [scoresLoadError, setScoresLoadError] = useState<string>('');
  const [matchesLoadError, setMatchesLoadError] = useState<string>('');

  const refreshTeams = useCallback(async () => {
    setTeamsLoadError('');
    try {
      const grouped = await fetchTeamsFromSupabase();
      setDbTeams(grouped);
    } catch (e: any) {
      setTeamsLoadError(e?.message || 'Failed to load teams from Supabase.');
    }
  }, []);

  const refreshMatches = useCallback(async () => {
    setMatchesLoadError('');
    try {
      const list = await fetchMatchesFromSupabase();
      setMatches(Array.isArray(list) ? list : []);
    } catch (e: any) {
      setMatches([]);
      setMatchesLoadError(e?.message || 'Failed to load matches from Supabase.');
    }
  }, []);

  const refreshPersistedScores = useCallback(async () => {
    setScoresLoadError('');
    try {
      const map = await fetchMatchScoresFromSupabase();
      setPersisted(map);
    } catch (e: any) {
      setPersisted({});
      setScoresLoadError(e?.message || 'Failed to load match scores from Supabase.');
    }
  }, []);

  const loadIdentity = useCallback(async () => {
    const t = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_TEAM);
    const p = await AsyncStorage.getItem(STORAGE_KEY_SELECTED_PLAYER_NAME);
    setMyTeam(t ? String(t) : null);
    setMyPlayerName(p ? String(p) : null);
  }, []);

  const loadAdmin = useCallback(async () => {
    const unlocked = await AsyncStorage.getItem(ADMIN_UNLOCK_KEY);
    setIsAdmin(unlocked === 'true');
  }, []);

  const loadCurrentWeek = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
    const w = safeInt(raw ?? '0', 0);
    if (w > 0) setSelectedWeek(w);
  }, []);

  useEffect(() => {
    refreshTeams();
    refreshMatches();
    refreshPersistedScores();
    loadIdentity();
    loadAdmin();
    loadCurrentWeek();
  }, [refreshTeams, refreshMatches, refreshPersistedScores, loadIdentity, loadAdmin, loadCurrentWeek]);

  useFocusEffect(
    useCallback(() => {
      refreshTeams();
      refreshMatches();
      refreshPersistedScores();
      loadIdentity();
      loadAdmin();
      loadCurrentWeek();
    }, [refreshTeams, refreshMatches, refreshPersistedScores, loadIdentity, loadAdmin, loadCurrentWeek])
  );

  const knownTeamsSet = useMemo(() => {
    const baseline = [
      ...DEFAULT_TEAMS_BY_DIVISION.Advanced,
      ...DEFAULT_TEAMS_BY_DIVISION.Intermediate,
      ...DEFAULT_TEAMS_BY_DIVISION.Beginner,
    ];

    const supa = [
      ...(dbTeams.Advanced ?? []).map((r) => r.name),
      ...(dbTeams.Intermediate ?? []).map((r) => r.name),
      ...(dbTeams.Beginner ?? []).map((r) => r.name),
    ];

    const fromMatches = matches.flatMap((m) => [m.teamA, m.teamB]);

    return new Set(uniqSorted([...baseline, ...supa, ...fromMatches]));
  }, [dbTeams, matches]);

  const canEditMatch = (m: SavedMatch) => {
    if (isAdmin) return true;
    if (!myTeam) return false;
    const mine = normalizeName(myTeam);
    return normalizeName(m.teamA) === mine || normalizeName(m.teamB) === mine;
  };

  const getFields = (matchId: string, teamName: string, persistedFields?: ScoreFields): ScoreFields => {
    const key = getTeamKey(matchId, teamName);
    const draft = scores[key];
    return {
      g1: draft?.g1 ?? (persistedFields?.g1 ?? ''),
      g2: draft?.g2 ?? (persistedFields?.g2 ?? ''),
      g3: draft?.g3 ?? (persistedFields?.g3 ?? ''),
    };
  };

  const setScore = (matchId: string, teamName: string, field: keyof ScoreFields, value: string) => {
    const key = getTeamKey(matchId, teamName);

    const match = matches.find((mm) => mm.id === matchId);
    const p = persisted[matchId];

    let persistedFieldsForTeam: ScoreFields | undefined = undefined;
    if (match && p) {
      if (match.teamA === teamName) persistedFieldsForTeam = p.teamA;
      else if (match.teamB === teamName) persistedFieldsForTeam = p.teamB;
    }

    setScores((prev) => {
      const existing = prev[key] ?? getFields(matchId, teamName, persistedFieldsForTeam);

      const next: ScoreFields = {
        g1: existing.g1,
        g2: existing.g2,
        g3: existing.g3,
        [field]: value,
      };

      return { ...prev, [key]: next };
    });
  };

  const confirmOnWeb = (message: string) => {
    // eslint-disable-next-line no-alert
    return window.confirm(message);
  };

  const onVerifyAndSave = async (m: SavedMatch) => {
    const editable = canEditMatch(m);
    if (!editable) {
      Alert.alert('Not allowed', 'You can only enter scores for your own match.');
      return;
    }

    const p = persisted[m.id];

    const teamAFields = getFields(m.id, m.teamA, p?.teamA);
    const teamBFields = getFields(m.id, m.teamB, p?.teamB);

    const aTotal = totalOf(teamAFields);
    const bTotal = totalOf(teamBFields);

    const gamesLine = statusLine(m.teamA, m.teamB, teamAFields, teamBFields);

    const by = isAdmin
      ? 'ADMIN'
      : (myPlayerName && myTeam ? `${myPlayerName} (${myTeam})` : (myTeam ?? 'UNKNOWN'));

    const summary = [
      `Week ${m.week} • ${m.division}`,
      `${m.time} • Court ${m.court}`,
      ``,
      `${m.teamA}: ${teamAFields.g1 || '-'}, ${teamAFields.g2 || '-'}, ${teamAFields.g3 || '-'} (Total ${aTotal})`,
      `${m.teamB}: ${teamBFields.g1 || '-'}, ${teamBFields.g2 || '-'}, ${teamBFields.g3 || '-'} (Total ${bTotal})`,
      gamesLine ? `\n${gamesLine}` : '',
      ``,
      `Verify & Save?`,
    ].filter(Boolean).join('\n');

    const doSave = async () => {
      const row: PersistedMatchScore = {
        matchId: m.id,
        teamA: teamAFields,
        teamB: teamBFields,
        verified: true,
        verifiedBy: by,
        verifiedAt: Date.now(), // ✅ local-only for UI
      };

      await upsertMatchScoreToSupabase(row);

      // ✅ Refresh persisted from Supabase after saving
      await refreshPersistedScores();
    };

    if (Platform.OS === 'web') {
      const ok = confirmOnWeb(summary);
      if (!ok) return;
      try {
        await doSave();
      } catch (e: any) {
        Alert.alert('Save failed', e?.message || 'Could not save scores to Supabase.');
      }
      return;
    }

    Alert.alert('Verify & Save', summary, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Yes, Verify & Save',
        onPress: () => {
          void (async () => {
            try {
              await doSave();
            } catch (e: any) {
              Alert.alert('Save failed', e?.message || 'Could not save scores to Supabase.');
            }
          })();
        },
      },
    ]);
  };

  const weekOptions = useMemo(() => {
    const set = new Set<number>();
    for (const m of matches) set.add(m.week);
    if (selectedWeek > 0) set.add(selectedWeek);
    return Array.from(set).sort((a, b) => a - b);
  }, [matches, selectedWeek]);

  const visibleMatches = useMemo(() => {
    const base = matches.filter((m) => m.week === selectedWeek);

    const teamFiltered = isAdmin
      ? base
      : myTeam
        ? base.filter((m) => normalizeName(m.teamA) === normalizeName(myTeam) || normalizeName(m.teamB) === normalizeName(myTeam))
        : [];

    if (!isAdmin) return teamFiltered;

    if (!adminPartialOnly) return teamFiltered;

    return teamFiltered.filter((m) => {
      const p = persisted[m.id];
      return persistedCompletionLabel(p) !== 'COMPLETED';
    });
  }, [matches, selectedWeek, isAdmin, myTeam, adminPartialOnly, persisted]);

  const groupedByDivision = useMemo(() => {
    const map = new Map<Division, SavedMatch[]>();
    for (const m of visibleMatches) {
      if (!map.has(m.division)) map.set(m.division, []);
      map.get(m.division)!.push(m);
    }

    return DIVISION_ORDER
      .filter((d) => map.has(d))
      .map((division) => {
        const list = [...(map.get(division) ?? [])].sort((a, b) => {
          const ta = TIMES.indexOf(a.time);
          const tb = TIMES.indexOf(b.time);
          if (ta !== tb) return ta - tb;
          return a.court - b.court;
        });
        return { division, matches: list };
      });
  }, [visibleMatches]);

  const myTeamUnknown = useMemo(() => {
    if (!myTeam) return false;
    if (knownTeamsSet.size === 0) return false;
    return !knownTeamsSet.has(normalizeName(myTeam));
  }, [myTeam, knownTeamsSet]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Text style={{ fontSize: 24, fontWeight: '900', marginBottom: 6 }}>Scoring</Text>

      <Text style={{ color: '#444', marginBottom: 12 }}>
        {isAdmin
          ? 'Admin Mode: ON (you can edit all matches)'
          : myTeam
            ? myPlayerName
              ? `You are: ${myPlayerName} (${myTeam})`
              : `You are: ${myTeam}`
            : 'Pick your team first to enter scores.'}
      </Text>

      {teamsLoadError ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 10 }}>
          Teams sync warning: {teamsLoadError}
        </Text>
      ) : null}

      {matchesLoadError ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 10 }}>
          Matches sync warning: {matchesLoadError}
        </Text>
      ) : null}

      {scoresLoadError ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 10 }}>
          Scores sync warning: {scoresLoadError}
        </Text>
      ) : null}

      {myTeamUnknown ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 10 }}>
          Team sync warning: Your selected team is not in the current Supabase/baseline team list. (Scoring still works, but confirm your team selection.)
        </Text>
      ) : null}

      <Text style={{ fontWeight: '900', marginBottom: 6 }}>Week</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 10 }}>
        <Picker selectedValue={selectedWeek} onValueChange={(v) => setSelectedWeek(Number(v))}>
          {weekOptions.map((w) => (
            <Picker.Item key={w} label={`Week ${w}`} value={w} />
          ))}
        </Picker>
      </View>

      {isAdmin ? (
        <Pressable
          onPress={() => setAdminPartialOnly((p) => !p)}
          style={{
            alignSelf: 'flex-start',
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: 'white',
            borderWidth: 1,
            borderColor: '#ccc',
            marginBottom: 14,
          }}
        >
          <Text style={{ fontWeight: '900' }}>
            {adminPartialOnly ? 'Filter: NOT COMPLETED only' : 'Filter: ALL'}
          </Text>
        </Pressable>
      ) : null}

      {groupedByDivision.length === 0 ? (
        <Text>
          {isAdmin ? 'No matches found for this week yet.' : 'No matches found for your team this week yet.'}
        </Text>
      ) : (
        <View style={{ gap: 18 }}>
          {groupedByDivision.map((section) => (
            <View key={section.division}>
              <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 10 }}>
                {section.division}
              </Text>

              <View style={{ gap: 14 }}>
                {section.matches.map((m) => {
                  const editable = canEditMatch(m);
                  const p = persisted[m.id];

                  const aFields = getFields(m.id, m.teamA, p?.teamA);
                  const bFields = getFields(m.id, m.teamB, p?.teamB);

                  const aTotal = totalOf(aFields);
                  const bTotal = totalOf(bFields);

                  const gamesLine = statusLine(m.teamA, m.teamB, aFields, bFields);

                  const verifiedLabel =
                    p?.verified ? `Verified by ${p.verifiedBy ?? 'UNKNOWN'}` : 'Not verified yet';

                  const badge = persistedCompletionLabel(p);

                  const completionNode =
                    badge === 'COMPLETED'
                      ? <Text style={{ color: 'green', fontWeight: '900' }}>COMPLETED</Text>
                      : badge === 'PARTIAL'
                        ? <Text style={{ color: 'red', fontWeight: '900' }}>PARTIAL</Text>
                        : null;

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
                      <View style={{ paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#000' }}>
                        <Text style={{ fontWeight: '900' }}>
                          Week {m.week} • {m.time} • Court {m.court}
                        </Text>

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                          <Text style={{ color: '#333', fontWeight: '700' }}>
                            {verifiedLabel}{gamesLine ? ` • ${gamesLine}` : ''}
                          </Text>
                          {completionNode ? <Text style={{ fontWeight: '900' }}>•</Text> : null}
                          {completionNode}
                        </View>

                        {!editable ? (
                          <Text style={{ marginTop: 4, color: '#555', fontWeight: '700' }}>
                            (Read-only — you can view scores but cannot edit this match)
                          </Text>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#000', paddingVertical: 8, backgroundColor: '#f5f5f5' }}>
                        <Text style={{ width: 110, fontWeight: '900', textAlign: 'center' }}>TIME</Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>COURT #</Text>
                        <Text style={{ flex: 2, fontWeight: '900', textAlign: 'center' }}>TEAM NAME</Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>G1</Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>G2</Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>G3</Text>
                        <Text style={{ width: 90, fontWeight: '900', textAlign: 'center' }}>TOTAL</Text>
                      </View>

                      <View style={{ flexDirection: 'row', paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ width: 110, textAlign: 'center' }}>{m.time}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{m.court}</Text>
                        <Text style={{ flex: 2, textAlign: 'center' }}>{m.teamA}</Text>

                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={aFields.g1} editable={editable} onChange={(v) => setScore(m.id, m.teamA, 'g1', v)} />
                        </View>
                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={aFields.g2} editable={editable} onChange={(v) => setScore(m.id, m.teamA, 'g2', v)} />
                        </View>
                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={aFields.g3} editable={editable} onChange={(v) => setScore(m.id, m.teamA, 'g3', v)} />
                        </View>

                        <Text style={{ width: 90, textAlign: 'center', fontWeight: '900' }}>{aTotal}</Text>
                      </View>

                      <View style={{ height: 1, backgroundColor: '#000' }} />

                      <View style={{ flexDirection: 'row', paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ width: 110, textAlign: 'center' }}>{m.time}</Text>
                        <Text style={{ width: 90, textAlign: 'center' }}>{m.court}</Text>
                        <Text style={{ flex: 2, textAlign: 'center' }}>{m.teamB}</Text>

                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={bFields.g1} editable={editable} onChange={(v) => setScore(m.id, m.teamB, 'g1', v)} />
                        </View>
                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={bFields.g2} editable={editable} onChange={(v) => setScore(m.id, m.teamB, 'g2', v)} />
                        </View>
                        <View style={{ width: 90 }}>
                          <ScoreInput initialValue={bFields.g3} editable={editable} onChange={(v) => setScore(m.id, m.teamB, 'g3', v)} />
                        </View>

                        <Text style={{ width: 90, textAlign: 'center', fontWeight: '900' }}>{bTotal}</Text>
                      </View>

                      <View style={{ borderTopWidth: 1, borderTopColor: '#000', padding: 10, backgroundColor: '#fafafa' }}>
                        <Pressable
                          onPress={() => { void onVerifyAndSave(m); }}
                          disabled={!editable}
                          style={{
                            backgroundColor: editable ? 'black' : '#999',
                            paddingVertical: 12,
                            borderRadius: 10,
                            alignItems: 'center',
                            opacity: editable ? 1 : 0.6,
                          }}
                        >
                          <Text style={{ color: 'white', fontWeight: '900' }}>Verify & Save</Text>
                        </Pressable>
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
