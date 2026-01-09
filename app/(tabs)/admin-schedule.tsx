import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type SavedMatch = {
  id: string;
  week: number;
  division: Division;
  time: string; // e.g. "6:15 PM"
  court: number; // 1..8
  teamA: string;
  teamB: string;
  createdAt: number;
};

const STORAGE_KEY_MATCHES = 'ppl_matches_v1';
const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week';

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

const COURTS = [1, 2, 3, 4, 5, 6, 7, 8];

// 6:00 PM → 9:45 PM, every 15 minutes
const TIMES: string[] = (() => {
  const result: string[] = [];
  let hour = 18; // 6 PM
  let minute = 0;

  while (hour < 22) {
    const displayHour = hour > 12 ? hour - 12 : hour;
    const displayMinute = String(minute).padStart(2, '0');
    result.push(`${displayHour}:${displayMinute} PM`);

    minute += 15;
    if (minute >= 60) {
      minute = 0;
      hour += 1;
    }

    // stop after 9:45 PM
    if (hour === 21 && minute === 60) break;
    if (hour === 22) break;
  }

  // Ensure last is 9:45 PM
  const last = result[result.length - 1];
  if (last !== '9:45 PM') {
    // rebuild safely if something ever changes
    return [
      '6:00 PM',
      '6:15 PM',
      '6:30 PM',
      '6:45 PM',
      '7:00 PM',
      '7:15 PM',
      '7:30 PM',
      '7:45 PM',
      '8:00 PM',
      '8:15 PM',
      '8:30 PM',
      '8:45 PM',
      '9:00 PM',
      '9:15 PM',
      '9:30 PM',
      '9:45 PM',
    ];
  }
  return result;
})();

function safeInt(value: string, fallback: number) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function sortMatches(list: SavedMatch[]) {
  return [...list].sort((a, b) => {
    if (a.week !== b.week) return a.week - b.week;
    if (a.division !== b.division) return a.division.localeCompare(b.division);
    if (a.time !== b.time) return a.time.localeCompare(b.time);
    return a.court - b.court;
  });
}

function getNewestWeekFromMatches(list: SavedMatch[]): number | null {
  if (!list || list.length === 0) return null;
  let max = -Infinity;
  for (const m of list) {
    if (typeof m.week === 'number' && Number.isFinite(m.week)) {
      if (m.week > max) max = m.week;
    }
  }
  return max === -Infinity ? null : max;
}

export default function AdminScheduleScreen() {
  // Form state
  const [week, setWeek] = useState('2'); // this drives the form "Week" input
  const [division, setDivision] = useState<Division>('Beginner');
  const [time, setTime] = useState<string>(TIMES[0]);
  const [court, setCourt] = useState<number>(1);

  const teams = useMemo(() => TEAMS_BY_DIVISION[division], [division]);

  const [teamA, setTeamA] = useState<string | null>(teams[0] ?? null);
  const [teamB, setTeamB] = useState<string | null>(teams[1] ?? null);

  // Saved data
  const [savedMatches, setSavedMatches] = useState<SavedMatch[]>([]);

  // ✅ Admin week filter state (controls what appears in the "Saved Matches" list)
  // "ALL" is optional and supported, but defaulting logic will choose a numeric week.
  const [listWeekFilter, setListWeekFilter] = useState<string>('ALL');

  // Edit mode
  const [editingId, setEditingId] = useState<string | null>(null);

  // Messages
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // ✅ Clear Week confirmation UI
  const [showClearWeekConfirm, setShowClearWeekConfirm] = useState(false);
  const [clearWeekConfirmText, setClearWeekConfirmText] = useState('');

  const weekNum = safeInt(week, 0);

  const readyToSave =
    weekNum > 0 && !!time && !!court && !!teamA && !!teamB && teamA !== teamB;

  // Load matches once + set default filter week
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY_MATCHES);
        let parsed: any = [];
        if (raw) {
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = [];
          }
        }
        const list: SavedMatch[] = Array.isArray(parsed) ? parsed : [];
        const sorted = sortMatches(list);
        setSavedMatches(sorted);

        // ✅ Default the admin list filter:
        // 1) AsyncStorage current week (if exists)
        // 2) newest week found in saved matches
        // 3) week 1
        let defaultWeek: number | null = null;

        const storedCurrentWeek = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
        if (storedCurrentWeek) {
          const cw = safeInt(storedCurrentWeek, 0);
          if (cw > 0) defaultWeek = cw;
        }

        if (!defaultWeek) {
          const newest = getNewestWeekFromMatches(sorted);
          if (newest && newest > 0) defaultWeek = newest;
        }

        if (!defaultWeek) defaultWeek = 1;

        setListWeekFilter(String(defaultWeek));

        // Optional: also populate the form week input to match the filter
        setWeek(String(defaultWeek));
      } catch {
        setSavedMatches([]);

        // Fallback defaults if something weird happens
        setListWeekFilter('1');
        setWeek('1');
      }
    })();
  }, []);

  const persistMatches = async (next: SavedMatch[]) => {
    const sorted = sortMatches(next);
    await AsyncStorage.setItem(STORAGE_KEY_MATCHES, JSON.stringify(sorted));
    setSavedMatches(sorted);
  };

  // ✅ BLOCK ONLY:
  // 1) Court double-booked (same week + same time + same court)  ✅ NOW ACROSS ALL DIVISIONS
  // 2) Team playing at same time (same week + same division + same time, team appears)
  const findConflictMessage = () => {
    if (!teamA || !teamB) return null;

    const conflict = savedMatches.find((m) => {
      if (editingId && m.id === editingId) return false;
      if (m.week !== weekNum) return false;
      if (m.time !== time) return false;

      // ✅ Court conflict across ALL divisions
      if (m.court === court) return true;

      // Team-time conflict should remain per-division (teams are division-specific)
      if (m.division === division) {
        const teamsInMatch = [m.teamA, m.teamB];
        if (teamsInMatch.includes(teamA) || teamsInMatch.includes(teamB)) return true;
      }

      return false;
    });

    if (!conflict) return null;

    // If court matches, show court booked (include which division it’s booked in)
    if (conflict.court === court && conflict.time === time && conflict.week === weekNum) {
      return `Court ${court} is already booked at ${time} (Week ${weekNum}, ${conflict.division}).`;
    }

    return `One of these teams is already scheduled at ${time} (Week ${weekNum}, ${division}).`;
  };

  const saveOrUpdate = async () => {
    setStatusMsg('');
    setErrorMsg('');

    if (!readyToSave || !teamA || !teamB) {
      setErrorMsg('Please fill everything out and pick two different teams.');
      return;
    }

    const conflictMsg = findConflictMessage();
    if (conflictMsg) {
      setErrorMsg(conflictMsg);
      Alert.alert('Conflict', conflictMsg);
      return;
    }

    const record: SavedMatch = {
      id: editingId ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      week: weekNum,
      division,
      time,
      court,
      teamA: teamA,
      teamB: teamB,
      createdAt: Date.now(),
    };

    const updated = editingId
      ? savedMatches.map((m) => (m.id === editingId ? record : m))
      : [...savedMatches, record];

    await persistMatches(updated);

    // Keep the list filter in sync with the week you’re editing/saving
    setListWeekFilter(String(weekNum));

    setEditingId(null);
    setStatusMsg(editingId ? '✅ Updated match.' : '✅ Saved match.');
  };

  const startEdit = (m: SavedMatch) => {
    setStatusMsg('');
    setErrorMsg('');
    setEditingId(m.id);

    setWeek(String(m.week));
    setDivision(m.division);
    setTime(m.time);
    setCourt(m.court);

    setTeamA(m.teamA);
    setTeamB(m.teamB);

    // Also jump the list filter to the match’s week so you can see it in context
    setListWeekFilter(String(m.week));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setStatusMsg('');
    setErrorMsg('');
  };

  const deleteMatch = async (id: string) => {
    setStatusMsg('');
    setErrorMsg('');
    const updated = savedMatches.filter((m) => m.id !== id);
    await persistMatches(updated);
    if (editingId === id) setEditingId(null);
    setStatusMsg('🗑️ Deleted match.');
  };

  // ✅ NEW: Clear ONLY the selected week (with typed confirmation)
  const openClearWeekConfirm = () => {
    setStatusMsg('');
    setErrorMsg('');
    setClearWeekConfirmText('');
    setShowClearWeekConfirm(true);
  };

  const getTargetWeekForClearWeek = () => {
    // Prefer the week filter if it's not ALL (because that is what you're viewing),
    // otherwise fall back to the Week input field.
    const fromFilter = listWeekFilter !== 'ALL' ? safeInt(listWeekFilter, 0) : 0;
    if (fromFilter > 0) return fromFilter;

    const fromInput = safeInt(week, 0);
    return fromInput > 0 ? fromInput : 0;
  };

  const confirmClearWeek = async () => {
    const targetWeek = getTargetWeekForClearWeek();
    if (targetWeek <= 0) {
      setErrorMsg('Pick a week first (Week filter or Week input).');
      setShowClearWeekConfirm(false);
      return;
    }

    if (clearWeekConfirmText.trim() !== 'Delete') {
      setErrorMsg('To confirm, you must type exactly: Delete');
      return;
    }

    const beforeCount = savedMatches.length;
    const updated = savedMatches.filter((m) => m.week !== targetWeek);
    const removed = beforeCount - updated.length;

    await persistMatches(updated);

    setShowClearWeekConfirm(false);
    setClearWeekConfirmText('');

    setListWeekFilter(String(targetWeek));
    setStatusMsg(removed > 0 ? `🧹 Cleared Week ${targetWeek} matches.` : `No matches found for Week ${targetWeek}.`);
  };

  const cancelClearWeek = () => {
    setShowClearWeekConfirm(false);
    setClearWeekConfirmText('');
  };

  const clearAllMatches = async () => {
    setStatusMsg('');
    setErrorMsg('');
    await AsyncStorage.removeItem(STORAGE_KEY_MATCHES);
    setSavedMatches([]);
    setEditingId(null);
    setStatusMsg('🧹 Cleared all saved matches.');

    // Reset filter + form week back to 1
    setListWeekFilter('1');
    setWeek('1');

    // Close week-confirm UI if open
    setShowClearWeekConfirm(false);
    setClearWeekConfirmText('');
  };

  // When division changes, make sure team buttons reflect that division’s teams
  useEffect(() => {
    const list = TEAMS_BY_DIVISION[division];
    if (!list.includes(teamA ?? '')) setTeamA(list[0] ?? null);
    if (!list.includes(teamB ?? '')) setTeamB(list[1] ?? null);
  }, [division]);

  const modeLabel = editingId ? 'Update Match' : 'Save Match';

  // ✅ Build admin list of weeks from saved matches
  const weekOptions = useMemo(() => {
    const set = new Set<number>();
    for (const m of savedMatches) {
      if (typeof m.week === 'number' && Number.isFinite(m.week) && m.week > 0) set.add(m.week);
    }
    const arr = Array.from(set).sort((a, b) => a - b);
    return arr;
  }, [savedMatches]);

  // ✅ Filtered saved matches list (by week, unless ALL)
  const filteredSavedMatches = useMemo(() => {
    if (listWeekFilter === 'ALL') return savedMatches;
    const w = safeInt(listWeekFilter, 0);
    if (w <= 0) return savedMatches;
    return savedMatches.filter((m) => m.week === w);
  }, [savedMatches, listWeekFilter]);

  const targetWeekPreview = getTargetWeekForClearWeek();
  const deleteEnabled = clearWeekConfirmText.trim() === 'Delete';

  return (
    <ScrollView contentContainerStyle={{ padding: 24 }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>
        Admin — Schedule Builder
      </Text>

      {statusMsg ? (
        <Text style={{ color: 'green', marginBottom: 8, fontWeight: '800' }}>
          {statusMsg}
        </Text>
      ) : null}
      {errorMsg ? (
        <Text style={{ color: 'red', marginBottom: 8, fontWeight: '800' }}>
          {errorMsg}
        </Text>
      ) : null}

      {/* ✅ ADMIN LIST WEEK FILTER */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>View Saved Matches</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={listWeekFilter} onValueChange={(v) => setListWeekFilter(String(v))}>
          <Picker.Item label="All Weeks" value="ALL" />
          {/* If there are no weeks yet, still show Week 1 so admin isn’t stuck */}
          {weekOptions.length === 0 ? (
            <Picker.Item label="Week 1" value="1" />
          ) : (
            weekOptions.map((w) => <Picker.Item key={w} label={`Week ${w}`} value={String(w)} />)
          )}
        </Picker>
      </View>

      {/* WEEK */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Week</Text>
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
        }}
      />

      {/* DIVISION */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Division</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {(['Advanced', 'Intermediate', 'Beginner'] as Division[]).map((d) => {
          const active = d === division;
          return (
            <Pressable
              key={d}
              onPress={() => setDivision(d)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 14,
                borderRadius: 999,
                backgroundColor: active ? 'black' : 'white',
                borderWidth: 1,
                borderColor: active ? 'black' : '#ccc',
              }}
            >
              <Text style={{ color: active ? 'white' : 'black', fontWeight: '800' }}>
                {d}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* TIME DROPDOWN */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Time</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={time} onValueChange={(v) => setTime(String(v))}>
          {TIMES.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      {/* COURT DROPDOWN */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Court</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={court} onValueChange={(v) => setCourt(Number(v))}>
          {COURTS.map((c) => (
            <Picker.Item key={c} label={`${c}`} value={c} />
          ))}
        </Picker>
      </View>

      {/* TEAM A */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Team A</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {teams.map((t) => {
          const active = t === teamA;
          return (
            <Pressable
              key={`A-${t}`}
              onPress={() => setTeamA(t)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: active ? 'black' : 'white',
                borderWidth: 1,
                borderColor: active ? 'black' : '#ccc',
              }}
            >
              <Text style={{ color: active ? 'white' : 'black', fontWeight: '800' }}>
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* TEAM B */}
      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Team B</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {teams.map((t) => {
          const active = t === teamB;
          return (
            <Pressable
              key={`B-${t}`}
              onPress={() => setTeamB(t)}
              style={{
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: active ? 'black' : 'white',
                borderWidth: 1,
                borderColor: active ? 'black' : '#ccc',
              }}
            >
              <Text style={{ color: active ? 'white' : 'black', fontWeight: '800' }}>
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* SAVE / UPDATE */}
      <Pressable
        onPress={saveOrUpdate}
        disabled={!readyToSave}
        style={{
          backgroundColor: readyToSave ? 'black' : '#999',
          padding: 14,
          borderRadius: 10,
          alignItems: 'center',
          opacity: readyToSave ? 1 : 0.5,
          marginBottom: 10,
        }}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '900' }}>{modeLabel}</Text>
      </Pressable>

      {editingId ? (
        <Pressable
          onPress={cancelEdit}
          style={{
            borderWidth: 1,
            borderColor: '#999',
            padding: 12,
            borderRadius: 10,
            alignItems: 'center',
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: '900' }}>Cancel Edit</Text>
        </Pressable>
      ) : null}

      {/* ✅ CLEAR WEEK (NEW, SAFE) */}
      <Pressable
        onPress={openClearWeekConfirm}
        style={{
          borderWidth: 1,
          borderColor: '#c62828',
          padding: 12,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <Text style={{ color: '#c62828', fontWeight: '900' }}>
          Clear THIS Week Matches
        </Text>
      </Pressable>

      {showClearWeekConfirm ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: '#c62828',
            borderRadius: 12,
            padding: 12,
            marginBottom: 18,
          }}
        >
          <Text style={{ fontWeight: '900', marginBottom: 6 }}>
            Confirm Clear Week
          </Text>
          <Text style={{ marginBottom: 10 }}>
            This will delete matches for{' '}
            <Text style={{ fontWeight: '900' }}>
              {targetWeekPreview > 0 ? `Week ${targetWeekPreview}` : 'the selected week'}
            </Text>{' '}
            only. Type exactly <Text style={{ fontWeight: '900' }}>Delete</Text> to confirm.
          </Text>

          <TextInput
            value={clearWeekConfirmText}
            onChangeText={setClearWeekConfirmText}
            placeholder="Type Delete"
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
              onPress={confirmClearWeek}
              disabled={!deleteEnabled}
              style={{
                backgroundColor: deleteEnabled ? '#c62828' : '#999',
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                flex: 1,
                opacity: deleteEnabled ? 1 : 0.5,
              }}
            >
              <Text style={{ color: 'white', fontWeight: '900' }}>
                Delete Week Matches
              </Text>
            </Pressable>

            <Pressable
              onPress={cancelClearWeek}
              style={{
                borderWidth: 1,
                borderColor: '#999',
                paddingVertical: 12,
                borderRadius: 10,
                alignItems: 'center',
                flex: 1,
              }}
            >
              <Text style={{ fontWeight: '900' }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* CLEAR ALL (KEEP FOR TESTING) */}
      <Pressable
        onPress={clearAllMatches}
        style={{
          borderWidth: 1,
          borderColor: '#c62828',
          padding: 12,
          borderRadius: 10,
          alignItems: 'center',
          marginBottom: 18,
        }}
      >
        <Text style={{ color: '#c62828', fontWeight: '900' }}>
          Clear ALL Saved Matches
        </Text>
      </Pressable>

      {/* LIST */}
      <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 10 }}>
        Saved Matches
      </Text>

      {filteredSavedMatches.length === 0 ? (
        <Text>No matches saved for this week.</Text>
      ) : (
        <View style={{ gap: 10, marginBottom: 30 }}>
          {filteredSavedMatches.map((m) => (
            <View
              key={m.id}
              style={{
                borderWidth: 1,
                borderColor: editingId === m.id ? 'black' : '#ddd',
                borderRadius: 12,
                padding: 12,
              }}
            >
              <Text style={{ fontWeight: '900', marginBottom: 4 }}>
                Week {m.week} • {m.division} • {m.time} • Court {m.court}
              </Text>
              <Text style={{ marginBottom: 10 }}>
                {m.teamA} vs {m.teamB}
              </Text>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => startEdit(m)}
                  style={{
                    backgroundColor: 'black',
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    flex: 1,
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: '900' }}>Edit</Text>
                </Pressable>

                <Pressable
                  onPress={() => deleteMatch(m.id)}
                  style={{
                    backgroundColor: '#c62828',
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    flex: 1,
                  }}
                >
                  <Text style={{ color: 'white', fontWeight: '900' }}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
