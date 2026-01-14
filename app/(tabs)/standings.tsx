import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

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

type ScoreFields = { g1: string; g2: string; g3: string };

type PersistedMatchScore = {
  matchId: string;
  teamA: ScoreFields;
  teamB: ScoreFields;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: number | null;
};

type TeamRow = {
  division: Division; // final “display division”
  team: string;
  gamesPlayed: number; // total games (not matches)
  wins: number; // game wins
  losses: number; // game losses
  pointsFor: number;
  pointsAgainst: number;
};

// ✅ Saved admin division moves
type DivisionMove = {
  id: string;
  team: string;
  fromDivision: Division;
  toDivision: Division;
  effectiveWeek: number;
  createdAt: number;
};

// ✅ Division moves stored here (from your Admin screen)
const STORAGE_KEY_DIVISION_MOVES = 'ppl_division_moves_v1';

// If Week 1 baseline has real stats, we only add week >= 2.
// If baseline is missing (or only has team list), we calculate from Week 1+ via Supabase scores.
const START_WEEK_FOR_AUTOCALC = 2;

const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

// ✅ Baseline teams (same baseline approach as Admin Teams / Scoring)
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
};

type SupabaseMatchScoreRow = {
  match_id: string;
  team_a: any;
  team_b: any;
  verified: boolean;
  verified_by: string | null;
  verified_at_ms: number | null;
};

type SupabaseStandingsBaseRow = {
  id?: string;
  created_at?: string;
  division: string;
  team: string;
  // NOTE: your current table may NOT have numeric columns — we handle that safely.
  games_played?: number | null;
  wins?: number | null;
  losses?: number | null;
  points_for?: number | null;
  points_against?: number | null;
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

function pointDiff(row: TeamRow) {
  return row.pointsFor - row.pointsAgainst;
}

function toN(s: string) {
  const n = parseInt((s ?? '').toString() || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ IMPORTANT:
 * - A score is "entered" if the string is NOT empty.
 * - A game is "entered" ONLY when BOTH teams have a score for that game.
 * This prevents blanks from being treated as 0.
 */
function isEnteredScore(v: string) {
  return (v ?? '').toString().trim() !== '';
}
function gameEnteredPair(a: string, b: string) {
  return isEnteredScore(a) && isEnteredScore(b);
}

function getMaxVerifiedWeek(matches: SavedMatch[], scores: Record<string, PersistedMatchScore>) {
  let max = 1;
  for (const m of matches) {
    const s = scores[m.id];
    if (!s || !s.verified) continue;
    if (typeof m.week === 'number' && Number.isFinite(m.week) && m.week > max) {
      max = m.week;
    }
  }
  return max;
}

// ✅ Find the team’s division as-of a given week using saved Division Moves
function getDivisionForTeamAsOfWeek(team: string, asOfWeek: number, moves: DivisionMove[]) {
  let best: DivisionMove | null = null;

  for (const mv of moves) {
    if (normalizeName(mv.team) !== normalizeName(team)) continue;
    if (mv.effectiveWeek > asOfWeek) continue;

    if (!best || mv.effectiveWeek > best.effectiveWeek) {
      best = mv;
    }
  }

  return best ? best.toDivision : null;
}

function getBaselineDivision(team: string): Division | null {
  const t = normalizeName(team);

  if (DEFAULT_TEAMS_BY_DIVISION.Advanced.some((x) => normalizeName(x) === t)) return 'Advanced';
  if (DEFAULT_TEAMS_BY_DIVISION.Intermediate.some((x) => normalizeName(x) === t)) return 'Intermediate';
  if (DEFAULT_TEAMS_BY_DIVISION.Beginner.some((x) => normalizeName(x) === t)) return 'Beginner';
  return null;
}

async function fetchTeamsFromSupabase(): Promise<Record<Division, SupabaseTeamRow[]>> {
  const url = supabaseRestUrl('teams?select=id,created_at,division,name&order=created_at.asc');

  const res = await fetch(url, { method: 'GET', headers: supabaseHeaders() });
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
    'matches?select=id,week,division,time,court,team_a,team_b&order=week.asc&order=division.asc&order=time.asc&order=court.asc'
  );

  const res = await fetch(url, { method: 'GET', headers: supabaseHeaders() });
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
  const g1 = v?.g1 == null ? '' : String(v.g1);
  const g2 = v?.g2 == null ? '' : String(v.g2);
  const g3 = v?.g3 == null ? '' : String(v.g3);
  return { g1, g2, g3 };
}

async function fetchMatchScoresFromSupabase(): Promise<Record<string, PersistedMatchScore>> {
  const url = supabaseRestUrl('match_scores?select=match_id,team_a,team_b,verified,verified_by,verified_at_ms');

  const res = await fetch(url, { method: 'GET', headers: supabaseHeaders() });
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

/**
 * ✅ Week 1 baseline (read-only forever) now lives in Supabase table: standings_base
 * We load it for EVERY device (Vercel included).
 *
 * Your current table may only have: division + team.
 * If numeric columns exist later, we’ll use them automatically.
 */
async function fetchStandingsBaseFromSupabase(): Promise<TeamRow[]> {
  // Try selecting numeric columns too (if they exist). If they don't, Supabase may error.
  // So we do a safe fallback attempt.
  const tryUrls = [
    supabaseRestUrl(
      'standings_base?select=division,team,games_played,wins,losses,points_for,points_against&order=division.asc&order=team.asc'
    ),
    supabaseRestUrl('standings_base?select=division,team&order=division.asc&order=team.asc'),
  ];

  let lastErr = '';

  for (const url of tryUrls) {
    const res = await fetch(url, { method: 'GET', headers: supabaseHeaders() });
    if (!res.ok) {
      lastErr = await res.text().catch(() => '');
      continue;
    }

    const rows = (await res.json()) as SupabaseStandingsBaseRow[];

    const out: TeamRow[] = [];
    for (const r of rows) {
      if (!isDivision(r.division)) continue;
      const team = normalizeName(r.team);
      if (!team) continue;

      out.push({
        division: r.division,
        team,
        gamesPlayed: Number(r.games_played ?? 0) || 0,
        wins: Number(r.wins ?? 0) || 0,
        losses: Number(r.losses ?? 0) || 0,
        pointsFor: Number(r.points_for ?? 0) || 0,
        pointsAgainst: Number(r.points_against ?? 0) || 0,
      });
    }

    return out;
  }

  throw new Error(`Failed to load standings_base from Supabase. ${lastErr ? `Details: ${lastErr}` : ''}`);
}

// ✅ Internal totals keyed by TEAM ONLY (so records can carry across divisions)
type TeamTotals = {
  team: string;
  originalDivision: Division;
  gamesPlayed: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

function addTotals(
  map: Map<string, TeamTotals>,
  add: Omit<TeamTotals, 'originalDivision'> & { originalDivision?: Division }
) {
  const key = normalizeName(add.team);
  if (!key) return;

  const prev = map.get(key);
  if (!prev) {
    map.set(key, {
      team: key,
      originalDivision: add.originalDivision ?? 'Beginner',
      gamesPlayed: add.gamesPlayed,
      wins: add.wins,
      losses: add.losses,
      pointsFor: add.pointsFor,
      pointsAgainst: add.pointsAgainst,
    });
    return;
  }

  map.set(key, {
    ...prev,
    originalDivision: prev.originalDivision ?? (add.originalDivision ?? 'Beginner'),
    gamesPlayed: prev.gamesPlayed + add.gamesPlayed,
    wins: prev.wins + add.wins,
    losses: prev.losses + add.losses,
    pointsFor: prev.pointsFor + add.pointsFor,
    pointsAgainst: prev.pointsAgainst + add.pointsAgainst,
  });
}

export default function StandingsScreen() {
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [scores, setScores] = useState<Record<string, PersistedMatchScore>>({});

  // Week 1 baseline + division moves
  const [baseRows, setBaseRows] = useState<TeamRow[]>([]);
  const [divisionMoves, setDivisionMoves] = useState<DivisionMove[]>([]);

  // Teams from Supabase (helps ensure new teams appear even with 0 games)
  const [dbTeams, setDbTeams] = useState<Record<Division, SupabaseTeamRow[]>>({
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  });

  const [teamsLoadError, setTeamsLoadError] = useState<string>('');
  const [matchesLoadError, setMatchesLoadError] = useState<string>('');
  const [scoresLoadError, setScoresLoadError] = useState<string>('');
  const [baseLoadError, setBaseLoadError] = useState<string>('');

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

  const refreshScores = useCallback(async () => {
    setScoresLoadError('');
    try {
      const map = await fetchMatchScoresFromSupabase();
      setScores(map);
    } catch (e: any) {
      setScores({});
      setScoresLoadError(e?.message || 'Failed to load match scores from Supabase.');
    }
  }, []);

  const loadAdminData = useCallback(async () => {
    // 1) Week 1 baseline from Supabase (shared forever)
    setBaseLoadError('');
    try {
      const base = await fetchStandingsBaseFromSupabase();
      setBaseRows(Array.isArray(base) ? base : []);
    } catch (e: any) {
      setBaseRows([]);
      setBaseLoadError(e?.message || 'Failed to load Week 1 baseline from Supabase.');
    }

    // 2) Division moves from Supabase (shared)
try {
  const url = supabaseRestUrl(
    'division_moves?select=id,team,from_division,to_division,effective_week,created_at&order=effective_week.asc&order=created_at.asc'
  );

  const res = await fetch(url, { method: 'GET', headers: supabaseHeaders() });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase division_moves SELECT failed: ${res.status} ${txt}`);
  }

  const rows = (await res.json()) as any[];

  const parsed: DivisionMove[] = rows
    .map((r) => ({
      id: String(r.id),
      team: String(r.team ?? ''),
      fromDivision: r.from_division as Division,
      toDivision: r.to_division as Division,
      effectiveWeek: Number(r.effective_week ?? 1) || 1,
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }))
    .filter(
      (mv) =>
        mv.team &&
        isDivision(mv.fromDivision) &&
        isDivision(mv.toDivision)
    );

  setDivisionMoves(parsed);
} catch {
  setDivisionMoves([]);
}

  }, []);

  useEffect(() => {
    void refreshTeams();
    void refreshMatches();
    void refreshScores();
    void loadAdminData();
  }, [refreshTeams, refreshMatches, refreshScores, loadAdminData]);

  useFocusEffect(
    useCallback(() => {
      void refreshTeams();
      void refreshMatches();
      void refreshScores();
      void loadAdminData();
    }, [refreshTeams, refreshMatches, refreshScores, loadAdminData])
  );

  const supabaseDivisionByTeam = useMemo(() => {
    const map = new Map<string, Division>();
    for (const div of DIVISION_ORDER) {
      for (const row of dbTeams[div] ?? []) {
        const name = normalizeName(row.name);
        if (!name) continue;
        map.set(name, div);
      }
    }
    return map;
  }, [dbTeams]);

  const baselineHasStats = useMemo(() => {
    return baseRows.some(
      (r) =>
        (r.gamesPlayed ?? 0) > 0 ||
        (r.wins ?? 0) > 0 ||
        (r.losses ?? 0) > 0 ||
        (r.pointsFor ?? 0) > 0 ||
        (r.pointsAgainst ?? 0) > 0
    );
  }, [baseRows]);

  const computed = useMemo(() => {
    const totals = new Map<string, TeamTotals>();

    // ✅ If baseline has REAL Week 1 stats, we only add from week >= 2.
    // ✅ If baseline is empty OR only teams/divisions, we calculate from week 1+ via Supabase verified scores.
    const startWeekForThisDevice = baselineHasStats ? START_WEEK_FOR_AUTOCALC : 1;

    // 0) Ensure ALL known teams exist (even if they have 0 games)
    const baselineAll = [
      ...DEFAULT_TEAMS_BY_DIVISION.Advanced,
      ...DEFAULT_TEAMS_BY_DIVISION.Intermediate,
      ...DEFAULT_TEAMS_BY_DIVISION.Beginner,
    ];

    const supaAll = [
      ...(dbTeams.Advanced ?? []).map((r) => r.name),
      ...(dbTeams.Intermediate ?? []).map((r) => r.name),
      ...(dbTeams.Beginner ?? []).map((r) => r.name),
    ];

    const fromMatchesAll = matches.flatMap((m) => [m.teamA, m.teamB]);

    const baseTeamList = baseRows.map((r) => r.team);

    const allKnownTeams = uniqSorted([...baselineAll, ...supaAll, ...fromMatchesAll, ...baseTeamList]);

    for (const team of allKnownTeams) {
      const t = normalizeName(team);
      if (!t) continue;

      const supaDiv = supabaseDivisionByTeam.get(t) ?? null;
      const baseDiv = getBaselineDivision(t);
      const hintDiv: Division = supaDiv ?? baseDiv ?? 'Beginner';

      addTotals(totals, {
        team: t,
        originalDivision: hintDiv,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      });
    }

    // 1) Seed totals from baseRows (Week 1 baseline) if baseline includes stats
    if (baselineHasStats) {
      for (const r of baseRows) {
        addTotals(totals, {
          team: r.team,
          originalDivision: r.division,
          gamesPlayed: r.gamesPlayed,
          wins: r.wins,
          losses: r.losses,
          pointsFor: r.pointsFor,
          pointsAgainst: r.pointsAgainst,
        });
      }
    }

    // 2) Add from VERIFIED scores only (from Supabase)
    for (const m of matches) {
      if (m.week < startWeekForThisDevice) continue;

      const s = scores[m.id];
      if (!s || !s.verified) continue;

      const aRaw = [s.teamA.g1, s.teamA.g2, s.teamA.g3];
      const bRaw = [s.teamB.g1, s.teamB.g2, s.teamB.g3];

      let aWins = 0;
      let bWins = 0;
      let gamesPlayed = 0;

      for (let i = 0; i < 3; i++) {
        if (!gameEnteredPair(aRaw[i], bRaw[i])) continue;

        gamesPlayed += 1;

        const ap = toN(aRaw[i]);
        const bp = toN(bRaw[i]);

        if (ap > bp) aWins += 1;
        else if (bp > ap) bWins += 1;
      }

      // ✅ points should ONLY count games that are fully entered (both teams have a score)
      let aPF = 0;
      let bPF = 0;

      for (let i = 0; i < 3; i++) {
        if (!gameEnteredPair(aRaw[i], bRaw[i])) continue;
        aPF += toN(aRaw[i]);
        bPF += toN(bRaw[i]);
      }

      addTotals(totals, {
        team: m.teamA,
        originalDivision: m.division,
        gamesPlayed,
        wins: aWins,
        losses: bWins,
        pointsFor: aPF,
        pointsAgainst: bPF,
      });

      addTotals(totals, {
        team: m.teamB,
        originalDivision: m.division,
        gamesPlayed,
        wins: bWins,
        losses: aWins,
        pointsFor: bPF,
        pointsAgainst: aPF,
      });
    }

    const asOfWeek = getMaxVerifiedWeek(matches, scores);

    // 3) Convert totals -> TeamRow, assigning FINAL display division via Division Moves
    const finalRows: TeamRow[] = [];
    for (const t of totals.values()) {
      const movedDivision = getDivisionForTeamAsOfWeek(t.team, asOfWeek, divisionMoves);
      const finalDivision = movedDivision ?? t.originalDivision;

      finalRows.push({
        division: finalDivision,
        team: t.team,
        gamesPlayed: t.gamesPlayed,
        wins: t.wins,
        losses: t.losses,
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgainst,
      });
    }

    // 4) Group by division + sort
    const byDiv = new Map<Division, TeamRow[]>();
    for (const r of finalRows) {
      if (!byDiv.has(r.division)) byDiv.set(r.division, []);
      byDiv.get(r.division)!.push(r);
    }

    return DIVISION_ORDER.map((division) => {
      const rows = (byDiv.get(division) ?? []).sort((x, y) => {
        // Teams with 0 games always at bottom
        const xZero = x.gamesPlayed === 0;
        const yZero = y.gamesPlayed === 0;
        if (xZero !== yZero) return xZero ? 1 : -1;

        // 1) Wins (higher first)
        if (y.wins !== x.wins) return y.wins - x.wins;

        // 2) Losses (lower first)
        if (x.losses !== y.losses) return x.losses - y.losses;

        // 3) Points For (higher first)
        if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;

        // 4) Points Against (lower first)
        if (x.pointsAgainst !== y.pointsAgainst) return x.pointsAgainst - y.pointsAgainst;

        return x.team.localeCompare(y.team);
      });

      return { division, rows };
    });
  }, [matches, scores, baseRows, divisionMoves, dbTeams, supabaseDivisionByTeam, baselineHasStats]);

  const standingsInfoText = useMemo(() => {
    if (baselineHasStats) {
      return `Standings are based on: Week 1 baseline + verified scores from Week ${START_WEEK_FOR_AUTOCALC}+ (synced via Supabase).`;
    }
    return `Standings are based on: verified scores from Week 1+ (synced via Supabase).`;
  }, [baselineHasStats]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 26, fontWeight: '900', marginBottom: 6 }}>Standings</Text>

      <Text style={{ color: '#444', marginBottom: 12 }}>{standingsInfoText}</Text>

      {baseLoadError ? (
        <Text style={{ color: '#b00020', fontWeight: '900', marginBottom: 10 }}>
          Baseline sync warning: {baseLoadError}
        </Text>
      ) : null}

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

      {computed.every((s) => s.rows.length === 0) ? (
        <Text>No standings yet.</Text>
      ) : (
        <View style={{ gap: 16 }}>
          {computed.map((section) => {
            if (section.rows.length === 0) return null;

            return (
              <View key={section.division}>
                <Text style={{ fontSize: 20, fontWeight: '900', marginBottom: 8 }}>
                  {section.division}
                </Text>

                {/* Header row */}
                <View
                  style={{
                    flexDirection: 'row',
                    borderWidth: 2,
                    borderColor: '#000',
                    backgroundColor: '#f2f2f2',
                  }}
                >
                  <Text style={{ width: 50, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    #
                  </Text>
                  <Text style={{ flex: 2.2, padding: 10, fontWeight: '900' }}>Team</Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    GP
                  </Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    W
                  </Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    L
                  </Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    PF
                  </Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    PA
                  </Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>
                    DIFF
                  </Text>
                </View>

                {/* Rows */}
                <View style={{ borderWidth: 2, borderColor: '#000', borderTopWidth: 0 }}>
                  {section.rows.map((r, idx) => (
                    <View
                      key={`${r.team}_${idx}`}
                      style={{
                        flexDirection: 'row',
                        borderTopWidth: idx === 0 ? 0 : 1,
                        borderTopColor: '#000',
                        backgroundColor: 'white',
                      }}
                    >
                      <Text style={{ width: 50, padding: 10, textAlign: 'center', fontWeight: '900' }}>
                        {idx + 1}
                      </Text>
                      <Text style={{ flex: 2.2, padding: 10, fontWeight: '700' }}>{r.team}</Text>
                      <Text style={{ width: 55, padding: 10, textAlign: 'center' }}>{r.gamesPlayed}</Text>
                      <Text style={{ width: 55, padding: 10, textAlign: 'center', fontWeight: '900' }}>{r.wins}</Text>
                      <Text style={{ width: 55, padding: 10, textAlign: 'center', fontWeight: '900' }}>{r.losses}</Text>
                      <Text style={{ width: 70, padding: 10, textAlign: 'center' }}>{r.pointsFor}</Text>
                      <Text style={{ width: 70, padding: 10, textAlign: 'center' }}>{r.pointsAgainst}</Text>
                      <Text style={{ width: 70, padding: 10, textAlign: 'center', fontWeight: '900' }}>
                        {pointDiff(r)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
