import AsyncStorage from '@react-native-async-storage/async-storage';
import { Picker } from '@react-native-picker/picker';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { supabaseHeaders, supabaseRestUrl } from '@/constants/supabase';

type Division = 'Beginner' | 'Intermediate' | 'Advanced';

type SavedMatch = {
  id: string;
  week: number;
  division: Division;
  time: string; // e.g. "6:15 PM"
  court: number; // 1..8
  teamA: string;
  teamB: string;
  createdAt: number; // Date.now() ms (legacy + used for ordering/labels)
};

// ✅ LEGACY (deprecated) — matches are now stored in Supabase `public.matches`
// Keeping the constant only for one-time migration import if Supabase is empty.
const STORAGE_KEY_MATCHES = 'ppl_matches_v1';

// ✅ Legacy current week (device-local). We will stop relying on it as a source of truth.
// We still read it if present to preserve user experience on this device.
const STORAGE_KEY_CURRENT_WEEK = 'ppl_current_week';

// ✅ Attendance storage (must match Admin Attendance screen)
const ATTENDANCE_KEY_PREFIX = 'ppl_team_attendance_week_v1_';
type AttendanceMap = Record<string, boolean>; // true = present, false = out

// ✅ Mid-season teams storage (legacy local) — still read for compatibility, but Supabase is now the source of truth
const STORAGE_KEY_CUSTOM_TEAMS = 'ppl_teams_by_division_v1';
type CustomTeams = Record<Division, string[]>;

// ✅ For debug (legacy key you asked to print)
const STORAGE_KEY_LEGACY_CUSTOM_TEAMS = 'ppl_custom_teams_v1';

// ✅ One-time migration flag (so we do NOT dual-source long term)
const STORAGE_KEY_MATCHES_MIGRATED = 'ppl_matches_migrated_to_supabase_v1';

// --- Default teams (baseline) ---
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

  const last = result[result.length - 1];
  if (last !== '9:45 PM') {
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

// ✅ A vs B equals B vs A
function matchupKey(a: string, b: string) {
  const pair = [a.trim(), b.trim()].sort((x, y) => x.localeCompare(y));
  return `${pair[0]}__VS__${pair[1]}`;
}

// ✅ Popup helper that works on BOTH web + native
function showPopup(title: string, message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
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

type SupabaseTeamRow = {
  id: string;
  created_at: string;
  division: string;
  name: string;
};

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

// =============================
// ✅ Supabase Matches (Schedule)
// =============================
type SupabaseMatchRow = {
  id: string;
  created_at: string;
  week: number;
  division: string;
  time: string;
  court: number;
  team_a: string;
  team_b: string;
  created_at_ms: number;
};

function rowToSavedMatch(r: SupabaseMatchRow): SavedMatch | null {
  if (!r) return null;
  if (!isDivision(r.division)) return null;

  return {
    id: String(r.id),
    week: Number(r.week),
    division: r.division as Division,
    time: String(r.time),
    court: Number(r.court),
    teamA: String(r.team_a),
    teamB: String(r.team_b),
    createdAt: Number(r.created_at_ms),
  };
}

function savedMatchToRow(m: SavedMatch): Omit<SupabaseMatchRow, 'created_at'> {
  return {
    id: m.id,
    week: m.week,
    division: m.division,
    time: m.time,
    court: m.court,
    team_a: m.teamA,
    team_b: m.teamB,
    created_at_ms: m.createdAt,
  };
}

async function fetchMatchesFromSupabase(): Promise<SavedMatch[]> {
  const url = supabaseRestUrl(
    'matches?select=id,created_at,week,division,time,court,team_a,team_b,created_at_ms&order=created_at_ms.asc'
  );

  const res = await fetch(url, {
    method: 'GET',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase matches SELECT failed: ${res.status} ${txt}`);
  }

  const rows = (await res.json()) as SupabaseMatchRow[];
  const list: SavedMatch[] = [];

  for (const r of rows) {
    const m = rowToSavedMatch(r);
    if (m) list.push(m);
  }

  return sortMatches(list);
}

async function upsertMatchToSupabase(match: SavedMatch): Promise<void> {
  // Upsert by id
  const url = supabaseRestUrl('matches?on_conflict=id');

  const headers = {
    ...supabaseHeaders(),
    Prefer: 'resolution=merge-duplicates,return=minimal',
    'Content-Type': 'application/json',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(savedMatchToRow(match)),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase matches UPSERT failed: ${res.status} ${txt}`);
  }
}

async function deleteMatchFromSupabase(id: string): Promise<void> {
  const url = supabaseRestUrl(`matches?id=eq.${encodeURIComponent(id)}`);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase matches DELETE failed: ${res.status} ${txt}`);
  }
}

async function deleteWeekFromSupabase(week: number): Promise<void> {
  const url = supabaseRestUrl(`matches?week=eq.${week}`);

  const res = await fetch(url, {
    method: 'DELETE',
    headers: supabaseHeaders(),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase matches DELETE week failed: ${res.status} ${txt}`);
  }
}

async function bulkInsertMatchesToSupabase(matches: SavedMatch[]): Promise<void> {
  if (!matches || matches.length === 0) return;

  const url = supabaseRestUrl('matches');

  const headers = {
    ...supabaseHeaders(),
    Prefer: 'return=minimal',
    'Content-Type': 'application/json',
  };

  const payload = matches.map((m) => savedMatchToRow(m));

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Supabase matches BULK INSERT failed: ${res.status} ${txt}`);
  }
}

export default function AdminScheduleScreen() {
  const { width } = useWindowDimensions();

  // ✅ Legacy local custom teams (often null now, since admin-teams.tsx clears ppl_teams_by_division_v1)
  const [customTeams, setCustomTeams] = useState<CustomTeams>({
    Beginner: [],
    Intermediate: [],
    Advanced: [],
  });

  // ✅ Supabase teams (source of truth for Manage Teams)
  const [dbTeams, setDbTeams] = useState<Record<Division, SupabaseTeamRow[]>>({
    Advanced: [],
    Intermediate: [],
    Beginner: [],
  });

  // ✅ DEBUG readout state (shows what AsyncStorage actually has)
  const [debugTeamsByDivisionRaw, setDebugTeamsByDivisionRaw] = useState<string>('(loading)');
  const [debugLegacyCustomTeamsRaw, setDebugLegacyCustomTeamsRaw] = useState<string>('(loading)');
  const [debugLastUpdatedAt, setDebugLastUpdatedAt] = useState<number>(Date.now());

  const refreshDebugStorage = async () => {
    try {
      const raw1 = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_TEAMS);
      setDebugTeamsByDivisionRaw(raw1 ?? '(null)');
    } catch (e: any) {
      setDebugTeamsByDivisionRaw(
        `(error reading ${STORAGE_KEY_CUSTOM_TEAMS}: ${e?.message || String(e)})`
      );
    }

    try {
      const raw2 = await AsyncStorage.getItem(STORAGE_KEY_LEGACY_CUSTOM_TEAMS);
      setDebugLegacyCustomTeamsRaw(raw2 ?? '(null)');
    } catch (e: any) {
      setDebugLegacyCustomTeamsRaw(
        `(error reading ${STORAGE_KEY_LEGACY_CUSTOM_TEAMS}: ${e?.message || String(e)})`
      );
    }

    setDebugLastUpdatedAt(Date.now());
  };

  const loadCustomTeams = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY_CUSTOM_TEAMS);
      const parsed = raw ? JSON.parse(raw) : null;

      const next: CustomTeams = {
        Beginner: parsed && Array.isArray(parsed.Beginner) ? parsed.Beginner : [],
        Intermediate: parsed && Array.isArray(parsed.Intermediate) ? parsed.Intermediate : [],
        Advanced: parsed && Array.isArray(parsed.Advanced) ? parsed.Advanced : [],
      };

      setCustomTeams({
        Beginner: uniqSorted(next.Beginner),
        Intermediate: uniqSorted(next.Intermediate),
        Advanced: uniqSorted(next.Advanced),
      });
    } catch {
      setCustomTeams({ Beginner: [], Intermediate: [], Advanced: [] });
    }
  };

  const loadTeamsFromSupabase = async () => {
    try {
      const grouped = await fetchTeamsFromSupabase();
      setDbTeams(grouped);
    } catch {
      // don't hard-fail UI — schedule builder still works with defaults
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

  // Form state
  const [week, setWeek] = useState('2'); // typed week field
  const [division, setDivision] = useState<Division>('Beginner');
  const [time, setTime] = useState<string>(TIMES[0]);
  const [court, setCourt] = useState<number>(1);

  // ✅ Merge base teams + Supabase teams + legacy local custom teams (per division)
  const teams = useMemo(() => {
    const base = TEAMS_BY_DIVISION[division] ?? [];
    const fromSupabase = dbTeamNamesByDivision[division] ?? [];
    const fromLocal = customTeams[division] ?? [];
    return uniqSorted([...base, ...fromSupabase, ...fromLocal]);
  }, [division, dbTeamNamesByDivision, customTeams]);

  const [teamA, setTeamA] = useState<string | null>(teams[0] ?? null);
  const [teamB, setTeamB] = useState<string | null>(teams[1] ?? null);

  // Saved data (NOW from Supabase)
  const [savedMatches, setSavedMatches] = useState<SavedMatch[]>([]);

  // ✅ Admin week filter state (controls what appears in the "Saved Matches" list)
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

  // ✅ Attendance map for the TYPED week (Week input field)
  const [attendance, setAttendance] = useState<AttendanceMap>({});
  const getAttendanceKeyForWeek = (w: number) => `${ATTENDANCE_KEY_PREFIX}${w}`;

  const loadAttendanceForTypedWeek = async (w: number) => {
    try {
      if (w <= 0) {
        setAttendance({});
        return;
      }
      const raw = await AsyncStorage.getItem(getAttendanceKeyForWeek(w));
      const parsed: AttendanceMap = raw ? JSON.parse(raw) : {};
      setAttendance(parsed && typeof parsed === 'object' ? parsed : {});
    } catch {
      setAttendance({});
    }
  };

  // ✅ Reload attendance whenever the Week INPUT changes
  useEffect(() => {
    void loadAttendanceForTypedWeek(weekNum);
  }, [weekNum]);

  const isTeamOutForTypedWeek = (teamName: string) => {
    // default is present unless explicitly false
    return attendance[teamName] === false;
  };

  // ✅ teams already scheduled at THIS slot (typed week + division + time)
  const scheduledTeamsThisSlot = useMemo(() => {
    const set = new Set<string>();
    if (weekNum <= 0) return set;

    for (const m of savedMatches) {
      if (editingId && m.id === editingId) continue;
      if (m.week !== weekNum) continue;
      if (m.division !== division) continue;
      if (m.time !== time) continue;

      set.add(m.teamA);
      set.add(m.teamB);
    }

    return set;
  }, [savedMatches, weekNum, division, time, editingId]);

  const isTeamBookedThisSlot = (teamName: string) => scheduledTeamsThisSlot.has(teamName);

  const readyToSave =
    weekNum > 0 && !!time && !!court && !!teamA && !!teamB && teamA !== teamB;

  const refreshMatches = async () => {
    const list = await fetchMatchesFromSupabase();
    setSavedMatches(list);
  };

  // ✅ One-time migration:
  // If Supabase has ZERO matches and we have legacy AsyncStorage matches, import them once.
  const maybeMigrateLegacyMatches = async () => {
    try {
      const migratedFlag = await AsyncStorage.getItem(STORAGE_KEY_MATCHES_MIGRATED);
      if (migratedFlag === 'true') return;

      const currentDb = await fetchMatchesFromSupabase();
      if (currentDb.length > 0) {
        await AsyncStorage.setItem(STORAGE_KEY_MATCHES_MIGRATED, 'true');
        return;
      }

      const rawLegacy = await AsyncStorage.getItem(STORAGE_KEY_MATCHES);
      let parsed: any = [];
      if (rawLegacy) {
        try {
          parsed = JSON.parse(rawLegacy);
        } catch {
          parsed = [];
        }
      }

      const legacyList: SavedMatch[] = Array.isArray(parsed) ? parsed : [];
      if (legacyList.length === 0) {
        await AsyncStorage.setItem(STORAGE_KEY_MATCHES_MIGRATED, 'true');
        return;
      }

      // Import
      await bulkInsertMatchesToSupabase(sortMatches(legacyList));
      await AsyncStorage.setItem(STORAGE_KEY_MATCHES_MIGRATED, 'true');
    } catch {
      // If migration fails, do NOT fall back to legacy as a dual source of truth.
      // Just leave it and let UI show what Supabase has.
    }
  };

  // Load matches + set default week + load teams
  useEffect(() => {
    (async () => {
      // ✅ load legacy local teams (if any)
      await loadCustomTeams();

      // ✅ load teams from Supabase
      await loadTeamsFromSupabase();

      // ✅ also load debug storage values
      await refreshDebugStorage();

      try {
        // ✅ ensure Supabase has the matches (import once if needed)
        await maybeMigrateLegacyMatches();

        // ✅ load matches from Supabase (single source of truth)
        const list = await fetchMatchesFromSupabase();
        setSavedMatches(list);

        let defaultWeek: number | null = null;

        // Preserve device UX if they previously stored a week locally
        const storedCurrentWeek = await AsyncStorage.getItem(STORAGE_KEY_CURRENT_WEEK);
        if (storedCurrentWeek) {
          const cw = safeInt(storedCurrentWeek, 0);
          if (cw > 0) defaultWeek = cw;
        }

        if (!defaultWeek) {
          const newest = getNewestWeekFromMatches(list);
          if (newest && newest > 0) defaultWeek = newest;
        }

        if (!defaultWeek) defaultWeek = 1;

        setListWeekFilter(String(defaultWeek));
        setWeek(String(defaultWeek));
      } catch {
        setSavedMatches([]);
        setListWeekFilter('1');
        setWeek('1');
      }
    })();
  }, []);

  // ✅ Hard-block conflicts (UNCHANGED)
  const findConflictMessage = () => {
    if (!teamA || !teamB) return null;

    const conflict = savedMatches.find((m) => {
      if (editingId && m.id === editingId) return false;
      if (m.week !== weekNum) return false;
      if (m.time !== time) return false;

      // ✅ Court conflict across ALL divisions
      if (m.court === court) return true;

      // Team-time conflict remains per-division
      if (m.division === division) {
        const teamsInMatch = [m.teamA, m.teamB];
        if (teamsInMatch.includes(teamA) || teamsInMatch.includes(teamB)) return true;
      }

      return false;
    });

    if (!conflict) return null;

    if (conflict.court === court && conflict.time === time && conflict.week === weekNum) {
      return `Court ${court} is already booked at ${time} (Week ${weekNum}, ${conflict.division}).`;
    }

    return `One of these teams is already scheduled at ${time} (Week ${weekNum}, ${division}).`;
  };

  // ✅ Duplicate matchup this week (across ALL divisions)
  const alreadyPlayingEachOtherThisWeek = () => {
    if (!teamA || !teamB || weekNum <= 0) return false;

    const key = matchupKey(teamA, teamB);

    return savedMatches.some((m) => {
      if (editingId && m.id === editingId) return false;
      if (m.week !== weekNum) return false;

      const existingKey = matchupKey(m.teamA, m.teamB);
      return existingKey === key;
    });
  };

  // ✅ count how many times these teams have played this season (all weeks + divisions)
  const timesPlayedThisSeason = () => {
    if (!teamA || !teamB) return 0;
    const key = matchupKey(teamA, teamB);

    let count = 0;
    for (const m of savedMatches) {
      if (editingId && m.id === editingId) continue;
      const existingKey = matchupKey(m.teamA, m.teamB);
      if (existingKey === key) count += 1;
    }
    return count;
  };

  // ✅ which week(s) these teams played (unique, sorted)
  const weeksPlayedThisSeason = () => {
    if (!teamA || !teamB) return [] as number[];
    const key = matchupKey(teamA, teamB);

    const set = new Set<number>();
    for (const m of savedMatches) {
      if (editingId && m.id === editingId) continue;
      const existingKey = matchupKey(m.teamA, m.teamB);
      if (existingKey !== key) continue;

      if (typeof m.week === 'number' && Number.isFinite(m.week) && m.week > 0) {
        set.add(m.week);
      }
    }

    return Array.from(set).sort((a, b) => a - b);
  };

  const doSave = async () => {
    if (!teamA || !teamB) return;

    const record: SavedMatch = {
      id: editingId ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      week: weekNum,
      division,
      time,
      court,
      teamA,
      teamB,
      createdAt: Date.now(),
    };

    try {
      await upsertMatchToSupabase(record);
      await refreshMatches();

      setListWeekFilter(String(weekNum));
      setEditingId(null);
      setStatusMsg(editingId ? '✅ Updated match.' : '✅ Saved match.');
    } catch (e: any) {
      const msg = e?.message || String(e);
      setErrorMsg(msg);
      showPopup('Supabase Error', msg);
    }
  };

  // ✅ one confirmation that always shows before saving
  const confirmSeasonPopupThenSave = async () => {
    const seasonCount = timesPlayedThisSeason();
    const weeks = weeksPlayedThisSeason();

    const weeksSuffix =
      seasonCount > 0 && weeks.length > 0 ? ` (wk${weeks.join(', wk')})` : '';

    const isDupThisWeek = alreadyPlayingEachOtherThisWeek();

    const message = isDupThisWeek
      ? `These teams are already playing each other this week (Week ${weekNum}).\n\nThese teams have played each other ${seasonCount} times this season${weeksSuffix}.\n\nDo you want to continue?`
      : `These teams have played each other ${seasonCount} times this season${weeksSuffix}.\n\nDo you want to continue?`;

    if (Platform.OS === 'web') {
      const ok = typeof window !== 'undefined' ? window.confirm(message) : false;
      if (ok) {
        await doSave();
      }
      return;
    }

    Alert.alert('Confirm Match', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: () => void doSave() },
    ]);
  };

  const saveOrUpdate = async () => {
    setStatusMsg('');
    setErrorMsg('');

    if (!readyToSave || !teamA || !teamB) {
      setErrorMsg('Please fill everything out and pick two different teams.');
      return;
    }

    // ✅ Hard-block 1: Attendance
    if (isTeamOutForTypedWeek(teamA) || isTeamOutForTypedWeek(teamB)) {
      const msg = `One or more selected teams are marked OUT for Week ${weekNum}. Please choose teams that are PRESENT.`;
      setErrorMsg(msg);
      showPopup('Attendance', msg);
      return;
    }

    // ✅ Hard-block 2: already booked at this slot
    if (isTeamBookedThisSlot(teamA) || isTeamBookedThisSlot(teamB)) {
      const msg = `One or more selected teams are already scheduled at ${time} (Week ${weekNum}, ${division}).`;
      setErrorMsg(msg);
      showPopup('Already Scheduled', msg);
      return;
    }

    // ✅ Hard-block 3: court/time conflicts
    const conflictMsg = findConflictMessage();
    if (conflictMsg) {
      setErrorMsg(conflictMsg);
      showPopup('Conflict', conflictMsg);
      return;
    }

    // ✅ Confirmation
    await confirmSeasonPopupThenSave();
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
    try {
      await deleteMatchFromSupabase(id);
      await refreshMatches();
      if (editingId === id) setEditingId(null);
      setStatusMsg('🗑️ Deleted match.');
    } catch (e: any) {
      const msg = e?.message || String(e);
      setErrorMsg(msg);
      showPopup('Supabase Error', msg);
    }
  };

  const openClearWeekConfirm = () => {
    setStatusMsg('');
    setErrorMsg('');
    setClearWeekConfirmText('');
    setShowClearWeekConfirm(true);
  };

  const getTargetWeekForClearWeek = () => {
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

    try {
      await deleteWeekFromSupabase(targetWeek);
      await refreshMatches();

      setShowClearWeekConfirm(false);
      setClearWeekConfirmText('');

      setListWeekFilter(String(targetWeek));
      setStatusMsg(`🧹 Cleared Week ${targetWeek} matches.`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setErrorMsg(msg);
      showPopup('Supabase Error', msg);
    }
  };

  const cancelClearWeek = () => {
    setShowClearWeekConfirm(false);
    setClearWeekConfirmText('');
  };

  // ✅ When division OR team sources change, keep team selection valid
  useEffect(() => {
    const list = teams;
    if (!list.includes(teamA ?? '')) setTeamA(list[0] ?? null);
    if (!list.includes(teamB ?? '')) setTeamB(list[1] ?? null);
  }, [division, teams]);

  const weekOptions = useMemo(() => {
    const set = new Set<number>();
    for (const m of savedMatches) {
      if (typeof m.week === 'number' && Number.isFinite(m.week) && m.week > 0) set.add(m.week);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [savedMatches]);

  // ✅ Saved matches list filtered by selected division + week filter
  const filteredSavedMatches = useMemo(() => {
    let list = savedMatches.filter((m) => m.division === division);

    if (listWeekFilter === 'ALL') return list;

    const w = safeInt(listWeekFilter, 0);
    if (w <= 0) return list;
    return list.filter((m) => m.week === w);
  }, [savedMatches, listWeekFilter, division]);

  const targetWeekPreview = getTargetWeekForClearWeek();
  const deleteEnabled = clearWeekConfirmText.trim() === 'Delete';

  const COLOR_GREEN = '#1f8a3b';
  const COLOR_RED = '#b3261e';
  const COLOR_YELLOW = '#f4c542';

  const renderTeamButton = (t: string, active: boolean, onPress: () => void) => {
    const isOut = isTeamOutForTypedWeek(t);
    const isBooked = isTeamBookedThisSlot(t);

    const disabled = isOut || (isBooked && !active);

    let bg = COLOR_GREEN;
    let textColor: 'white' | 'black' = 'white';

    if (isOut) {
      bg = COLOR_RED;
      textColor = 'white';
    } else if (isBooked && !active) {
      bg = COLOR_YELLOW;
      textColor = 'black';
    }

    if (active) {
      bg = 'black';
      textColor = 'white';
    }

    return (
      <Pressable
        key={t}
        onPress={onPress}
        disabled={disabled}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 12,
          borderRadius: 10,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: '#ccc',
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <Text style={{ color: textColor, fontWeight: '800' }}>{t}</Text>
      </Pressable>
    );
  };

  const contentPadding = 24;
  const tileGap = 10;

  const numColumns = useMemo(() => {
    if (width >= 900) return 5;
    if (width >= 750) return 4;
    if (width >= 600) return 3;
    return 2;
  }, [width]);

  const tileWidth = useMemo(() => {
    const totalGaps = tileGap * (numColumns - 1);
    const available = width - contentPadding * 2 - totalGaps;
    const raw = available / numColumns;
    return Math.max(140, Math.floor(raw));
  }, [width, numColumns]);

  // ✅ compute "how many times these two teams have played each other BEFORE this match"
  const getTimesPlayedBeforeThisMatch = (match: SavedMatch) => {
    const key = matchupKey(match.teamA, match.teamB);
    let count = 0;

    for (const m of savedMatches) {
      if (m.id === match.id) continue;
      if (matchupKey(m.teamA, m.teamB) !== key) continue;

      if (m.createdAt < match.createdAt) count += 1;
    }

    return count;
  };

  return (
    <ScrollView contentContainerStyle={{ padding: contentPadding }}>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginBottom: 12 }}>
        Admin — Schedule Builder
      </Text>

      {statusMsg ? (
        <Text style={{ color: 'green', marginBottom: 8, fontWeight: '800' }}>{statusMsg}</Text>
      ) : null}
      {errorMsg ? (
        <Text style={{ color: 'red', marginBottom: 8, fontWeight: '800' }}>{errorMsg}</Text>
      ) : null}

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>View Saved Matches</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={listWeekFilter} onValueChange={(v) => setListWeekFilter(String(v))}>
          <Picker.Item label="All Weeks" value="ALL" />
          {weekOptions.length === 0 ? (
            <Picker.Item label="Week 1" value="1" />
          ) : (
            weekOptions.map((w) => <Picker.Item key={w} label={`Week ${w}`} value={String(w)} />)
          )}
        </Picker>
      </View>

      <Text style={{ fontWeight: '900', marginBottom: 6, fontSize: 16 }}>
        YOU ARE CURRENTLY SCHEDULING FOR WEEK #
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
          textAlign: 'left',
        }}
      />

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
              <Text style={{ color: active ? 'white' : 'black', fontWeight: '800' }}>{d}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Time</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={time} onValueChange={(v) => setTime(String(v))}>
          {TIMES.map((t) => (
            <Picker.Item key={t} label={t} value={t} />
          ))}
        </Picker>
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Court</Text>
      <View style={{ borderWidth: 1, borderColor: '#ccc', borderRadius: 10, marginBottom: 14 }}>
        <Picker selectedValue={court} onValueChange={(v) => setCourt(Number(v))}>
          {COURTS.map((c) => (
            <Picker.Item key={c} label={`${c}`} value={c} />
          ))}
        </Picker>
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Team A</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {teams.map((t) => renderTeamButton(t, t === teamA, () => setTeamA(t)))}
      </View>

      <Text style={{ fontWeight: '800', marginBottom: 6 }}>Team B</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        {teams.map((t) => renderTeamButton(t, t === teamB, () => setTeamB(t)))}
      </View>

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
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '900' }}>
          {editingId ? 'Update Match' : 'Save Match'}
        </Text>
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
        <Text style={{ color: '#c62828', fontWeight: '900' }}>Clear THIS Week Matches</Text>
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
          <Text style={{ fontWeight: '900', marginBottom: 6 }}>Confirm Clear Week</Text>
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
              <Text style={{ color: 'white', fontWeight: '900' }}>Delete Week Matches</Text>
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

      <Text style={{ fontSize: 18, fontWeight: '900', marginBottom: 10 }}>Saved Matches</Text>

      {filteredSavedMatches.length === 0 ? (
        <Text>No matches saved for this week.</Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 30 }}>
          {filteredSavedMatches.map((m) => {
            const timesBefore = getTimesPlayedBeforeThisMatch(m);

            return (
              <View
                key={m.id}
                style={{
                  width: tileWidth,
                  borderWidth: 1,
                  borderColor: editingId === m.id ? 'black' : '#ddd',
                  borderRadius: 12,
                  padding: 10,
                  position: 'relative',
                }}
              >
                <Text
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 10,
                    fontSize: 26,
                    fontWeight: '900',
                    color: '#00BFFF',
                    textShadowColor: '#00BFFF',
                    textShadowOffset: { width: 0, height: 0 },
                    textShadowRadius: 12,
                  }}
                >
                  {timesBefore}x
                </Text>

                <Text style={{ fontWeight: '900', marginBottom: 4, fontSize: 12 }}>
                  Week {m.week} • {m.time} • Ct {m.court}
                </Text>
                <Text style={{ fontSize: 12, marginBottom: 8 }}>
                  {m.teamA} vs {m.teamB}
                </Text>

                <View style={{ gap: 8 }}>
                  <Pressable
                    onPress={() => startEdit(m)}
                    style={{
                      backgroundColor: 'black',
                      paddingVertical: 8,
                      borderRadius: 10,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: 'white', fontWeight: '900', fontSize: 12 }}>Edit</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => deleteMatch(m.id)}
                    style={{
                      backgroundColor: '#c62828',
                      paddingVertical: 8,
                      borderRadius: 10,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: 'white', fontWeight: '900', fontSize: 12 }}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
