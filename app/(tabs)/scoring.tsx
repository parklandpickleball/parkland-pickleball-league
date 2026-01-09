import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import { useFocusEffect } from 'expo-router';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

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

const STORAGE_KEY_MATCHES = 'ppl_matches_v1';
const STORAGE_KEY_SELECTED_TEAM = 'ppl_selected_team';
const STORAGE_KEY_SELECTED_PLAYER_NAME = 'ppl_selected_player_name';
const ADMIN_UNLOCK_KEY = 'ppl_admin_unlocked';
const STORAGE_KEY_SCORES = 'ppl_scores_v1';
const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week_v1';

type ScoreFields = { g1: string; g2: string; g3: string };

type PersistedMatchScore = {
  matchId: string;
  teamA: ScoreFields;
  teamB: ScoreFields;
  verified: boolean;
  verifiedBy: string | null;
  verifiedAt: number | null;
};

const DIVISION_ORDER: Division[] = ['Advanced', 'Intermediate', 'Beginner'];

const TIMES: string[] = [
  '6:00 PM','6:15 PM','6:30 PM','6:45 PM',
  '7:00 PM','7:15 PM','7:30 PM','7:45 PM',
  '8:00 PM','8:15 PM','8:30 PM','8:45 PM',
  '9:00 PM','9:15 PM','9:30 PM','9:45 PM',
];

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
    // ✅ only count a game if BOTH scores are entered
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

  // If literally nothing is entered for any game for either team, show nothing
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
 * COMPLETED only when G1/G2/G3 are entered for BOTH teams.
 * PARTIAL if at least one complete game exists but not all 3.
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

  // Draft edits. IMPORTANT: keep even if fields are ''.
  const [scores, setScores] = useState<Record<string, ScoreFields>>({});
  const [persisted, setPersisted] = useState<Record<string, PersistedMatchScore>>({});

  const [selectedWeek, setSelectedWeek] = useState<number>(1);
  const [adminPartialOnly, setAdminPartialOnly] = useState<boolean>(false);

  const loadMatches = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_MATCHES);
    if (!raw) return setMatches([]);
    try {
      const parsed = JSON.parse(raw);
      setMatches(Array.isArray(parsed) ? parsed : []);
    } catch {
      setMatches([]);
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

  const loadScores = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_SCORES);
    if (!raw) return setPersisted({});
    try {
      const parsed = JSON.parse(raw);
      setPersisted(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setPersisted({});
    }
  }, []);

  const loadCurrentWeek = useCallback(async () => {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
    const w = safeInt(raw ?? '0', 0);
    if (w > 0) setSelectedWeek(w);
  }, []);

  useEffect(() => {
    loadMatches();
    loadIdentity();
    loadAdmin();
    loadScores();
    loadCurrentWeek();
  }, [loadMatches, loadIdentity, loadAdmin, loadScores, loadCurrentWeek]);

  useFocusEffect(
    useCallback(() => {
      loadIdentity();
      loadAdmin();
      loadMatches();
      loadScores();
      loadCurrentWeek();
    }, [loadIdentity, loadAdmin, loadMatches, loadScores, loadCurrentWeek])
  );

  const canEditMatch = (m: SavedMatch) => {
    if (isAdmin) return true;
    if (!myTeam) return false;
    return m.teamA === myTeam || m.teamB === myTeam;
  };

  // Merge persisted + draft. Draft overrides persisted even if draft value is ''.
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

  const persistScores = async (nextPersisted: Record<string, PersistedMatchScore>) => {
    await AsyncStorage.setItem(STORAGE_KEY_SCORES, JSON.stringify(nextPersisted));
    setPersisted(nextPersisted);
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
      const next: Record<string, PersistedMatchScore> = {
        ...persisted,
        [m.id]: {
          matchId: m.id,
          teamA: teamAFields,
          teamB: teamBFields,
          verified: true,
          verifiedBy: by,
          verifiedAt: Date.now(),
        },
      };
      await persistScores(next);
    };

    if (Platform.OS === 'web') {
      const ok = confirmOnWeb(summary);
      if (!ok) return;
      await doSave();
      return;
    }

    Alert.alert('Verify & Save', summary, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Yes, Verify & Save', onPress: () => { void doSave(); } },
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
        ? base.filter((m) => m.teamA === myTeam || m.teamB === myTeam)
        : [];

    if (!isAdmin) return teamFiltered;

    if (!adminPartialOnly) return teamFiltered;

    // ✅ Admin "partial only" now means: NOT COMPLETED based on persisted saved games
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

                  // ✅ COMPLETED/PARTIAL is based ONLY on persisted saved values (NOT typing)
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
