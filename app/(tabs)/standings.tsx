import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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
  division: Division;
  team: string;
  gamesPlayed: number; // total games (not matches)
  wins: number;        // game wins
  losses: number;      // game losses
  pointsFor: number;
  pointsAgainst: number;
};

const STORAGE_KEY_MATCHES = 'ppl_matches_v1';
const STORAGE_KEY_SCORES = 'ppl_scores_v1';
const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';

// Week 1 baseline stored here:
const STORAGE_KEY_BASE = 'ppl_standings_base_v1';

// We will ONLY calculate additions from week >= 2
const START_WEEK_FOR_AUTOCALC = 2;

const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

function toN(s: string) {
  const n = parseInt(s || '0', 10);
  return Number.isFinite(n) ? n : 0;
}

function isEntered(a: number, b: number) {
  // If both are 0, assume not entered yet
  return !(a === 0 && b === 0);
}

function addRow(map: Map<string, TeamRow>, row: TeamRow) {
  const key = `${row.division}__${row.team}`;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, row);
    return;
  }
  map.set(key, {
    ...prev,
    gamesPlayed: prev.gamesPlayed + row.gamesPlayed,
    wins: prev.wins + row.wins,
    losses: prev.losses + row.losses,
    pointsFor: prev.pointsFor + row.pointsFor,
    pointsAgainst: prev.pointsAgainst + row.pointsAgainst,
  });
}

function pointDiff(row: TeamRow) {
  return row.pointsFor - row.pointsAgainst;
}

export default function StandingsScreen() {
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [scores, setScores] = useState<Record<string, PersistedMatchScore>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  // Week 1 baseline stored in AsyncStorage (admin sets once)
  const [baseRows, setBaseRows] = useState<TeamRow[]>([]);
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  const loadAll = async () => {
    const [rawMatches, rawScores, rawAdmin, rawBase] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_MATCHES),
      AsyncStorage.getItem(STORAGE_KEY_SCORES),
      AsyncStorage.getItem(ADMIN_UNLOCK_KEY),
      AsyncStorage.getItem(STORAGE_KEY_BASE),
    ]);

    // Matches
    try {
      const parsed = rawMatches ? JSON.parse(rawMatches) : [];
      setMatches(Array.isArray(parsed) ? parsed : []);
    } catch {
      setMatches([]);
    }

    // Scores
    try {
      const parsed = rawScores ? JSON.parse(rawScores) : {};
      setScores(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setScores({});
    }

    // Admin
    setIsAdmin(rawAdmin === 'true');

    // Base Week 1
    try {
      const parsed = rawBase ? JSON.parse(rawBase) : [];
      setBaseRows(Array.isArray(parsed) ? parsed : []);
    } catch {
      setBaseRows([]);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const computed = useMemo(() => {
    // Aggregate Week 2+ from VERIFIED scores only
    const agg = new Map<string, TeamRow>();

    for (const m of matches) {
      if (m.week < START_WEEK_FOR_AUTOCALC) continue;

      const s = scores[m.id];
      if (!s || !s.verified) continue;

      // Team A points per game
      const a = [toN(s.teamA.g1), toN(s.teamA.g2), toN(s.teamA.g3)];
      const b = [toN(s.teamB.g1), toN(s.teamB.g2), toN(s.teamB.g3)];

      let aWins = 0;
      let bWins = 0;
      let aPlayed = 0;
      let bPlayed = 0;

      for (let i = 0; i < 3; i++) {
        const ap = a[i];
        const bp = b[i];

        if (!isEntered(ap, bp)) continue;

        aPlayed += 1;
        bPlayed += 1;

        if (ap > bp) aWins += 1;
        else if (bp > ap) bWins += 1;
        // ties do nothing (rare, but allowed)
      }

      // points
      const aPF = a.reduce((sum, n) => sum + n, 0);
      const bPF = b.reduce((sum, n) => sum + n, 0);

      addRow(agg, {
        division: m.division,
        team: m.teamA,
        gamesPlayed: aPlayed,
        wins: aWins,
        losses: bWins,
        pointsFor: aPF,
        pointsAgainst: bPF,
      });

      addRow(agg, {
        division: m.division,
        team: m.teamB,
        gamesPlayed: bPlayed,
        wins: bWins,
        losses: aWins,
        pointsFor: bPF,
        pointsAgainst: aPF,
      });
    }

    // Merge base + computed
    const merged = new Map<string, TeamRow>();

    for (const r of baseRows) addRow(merged, r);
    for (const r of agg.values()) addRow(merged, r);

    // group by division
    const byDiv = new Map<Division, TeamRow[]>();
    for (const r of merged.values()) {
      if (!byDiv.has(r.division)) byDiv.set(r.division, []);
      byDiv.get(r.division)!.push(r);
    }

    const sections = DIVISION_ORDER.map((division) => {
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

        // final stable tie-breaker
        return x.team.localeCompare(y.team);
      });

      return { division, rows };
    });

    return sections;
  }, [matches, scores, baseRows]);

  const saveBase = async (rows: TeamRow[]) => {
    await AsyncStorage.setItem(STORAGE_KEY_BASE, JSON.stringify(rows));
    setBaseRows(rows);
  };

  const tryImportWeek1 = async () => {
    const raw = (importText || '').trim();
    if (!raw) {
      Alert.alert('Nothing to import', 'Paste Week 1 standings JSON first.');
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        Alert.alert('Invalid format', 'Week 1 standings must be a JSON array.');
        return;
      }

      // Minimal validation
      const cleaned: TeamRow[] = parsed.map((r: any) => ({
        division: r.division,
        team: String(r.team ?? ''),
        gamesPlayed: Number(r.gamesPlayed ?? 0) || 0,
        wins: Number(r.wins ?? 0) || 0,
        losses: Number(r.losses ?? 0) || 0,
        pointsFor: Number(r.pointsFor ?? 0) || 0,
        pointsAgainst: Number(r.pointsAgainst ?? 0) || 0,
      }));

      const ok = cleaned.every((r) =>
        (r.division === 'Advanced' || r.division === 'Intermediate' || r.division === 'Beginner') &&
        r.team.length > 0
      );

      if (!ok) {
        Alert.alert(
          'Invalid rows',
          'Each row must include: division ("Advanced"/"Intermediate"/"Beginner") and team.'
        );
        return;
      }

      await saveBase(cleaned);
      Alert.alert('Saved', 'Week 1 baseline standings have been saved.');
      setShowImport(false);
      setImportText('');
    } catch {
      Alert.alert('Invalid JSON', 'The pasted Week 1 standings is not valid JSON.');
    }
  };

  const shouldShowImportUI = isAdmin && baseRows.length === 0;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Text style={{ fontSize: 26, fontWeight: '900', marginBottom: 6 }}>Standings</Text>

      <Text style={{ color: '#444', marginBottom: 12 }}>
        Standings are based on: Week 1 baseline + verified scores from Week {START_WEEK_FOR_AUTOCALC}+.
      </Text>

      {/* Admin Week 1 Import (ONLY if baseline not set yet) */}
      {shouldShowImportUI ? (
        <View style={{ borderWidth: 2, borderColor: '#000', borderRadius: 12, padding: 12, marginBottom: 14 }}>
          <Text style={{ fontWeight: '900', marginBottom: 6 }}>Admin</Text>

          <Text style={{ color: '#333', marginBottom: 10 }}>
            Set Week 1 starting standings one time (JSON). After that, weeks 2+ will add automatically.
          </Text>

          <Pressable
            onPress={() => setShowImport((v) => !v)}
            style={{
              backgroundColor: 'black',
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 10,
              alignSelf: 'flex-start',
            }}
          >
            <Text style={{ color: 'white', fontWeight: '900' }}>
              {showImport ? 'Hide Week 1 Import' : 'Import Week 1 Standings'}
            </Text>
          </Pressable>

          {showImport ? (
            <View style={{ marginTop: 12 }}>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>Paste JSON array here:</Text>
              <TextInput
                value={importText}
                onChangeText={setImportText}
                multiline
                placeholder='Example: [{"division":"Advanced","team":"Brandon/Ikewa","gamesPlayed":3,"wins":2,"losses":1,"pointsFor":33,"pointsAgainst":28}]'
                style={{
                  borderWidth: 1,
                  borderColor: '#000',
                  borderRadius: 10,
                  padding: 10,
                  minHeight: 140,
                  textAlignVertical: 'top',
                  backgroundColor: 'white',
                }}
              />

              <Pressable
                onPress={() => { void tryImportWeek1(); }}
                style={{
                  marginTop: 10,
                  backgroundColor: 'black',
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: 'white', fontWeight: '900' }}>
                  Save Week 1 Baseline
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {computed.every((s) => s.rows.length === 0) ? (
        <Text>No standings yet. Add Week 1 baseline (admin) and/or verify some scores.</Text>
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
                <View style={{ flexDirection: 'row', borderWidth: 2, borderColor: '#000', backgroundColor: '#f2f2f2' }}>
                  <Text style={{ width: 50, padding: 10, fontWeight: '900', textAlign: 'center' }}>#</Text>
                  <Text style={{ flex: 2.2, padding: 10, fontWeight: '900' }}>Team</Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>GP</Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>W</Text>
                  <Text style={{ width: 55, padding: 10, fontWeight: '900', textAlign: 'center' }}>L</Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>PF</Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>PA</Text>
                  <Text style={{ width: 70, padding: 10, fontWeight: '900', textAlign: 'center' }}>DIFF</Text>
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
