import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

const TEAM_KEY = 'ppl_selected_team';
const PLAYER_INDEX_KEY = 'ppl_selected_player_index'; // "1" or "2"
const PLAYER_NAME_KEY = 'ppl_selected_player_name';   // e.g. "Ishai" or "Greg"

export default function TeamSelectScreen() {
  const router = useRouter();

  const [pendingTeam, setPendingTeam] = useState<string | null>(null);

  const pendingPlayers = useMemo(() => {
    if (!pendingTeam) return null;

    const parts = pendingTeam.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { p1: parts[0], p2: parts[1] };

    return { p1: pendingTeam, p2: '' };
  }, [pendingTeam]);

  const beginChooseTeam = (team: string) => setPendingTeam(team);

  // ✅ Always route through root to guarantee valid tab context
  const goIntoApp = () => {
    router.replace('/');
  };

  const saveSelection = async (team: string, playerIndex: '1' | '2', playerName: string) => {
    try {
      await AsyncStorage.setItem(TEAM_KEY, team);
      await AsyncStorage.setItem(PLAYER_INDEX_KEY, playerIndex);
      await AsyncStorage.setItem(PLAYER_NAME_KEY, playerName);

      goIntoApp();
    } catch (e) {
      Alert.alert('Error', 'Could not save your team choice. Please try again.');
    }
  };

  const choosePlayer1 = () => {
    if (!pendingTeam || !pendingPlayers) return;
    const name = pendingPlayers.p1;
    if (!name) return;
    void saveSelection(pendingTeam, '1', name);
  };

  const choosePlayer2 = () => {
    if (!pendingTeam || !pendingPlayers) return;
    const name = pendingPlayers.p2;
    if (!name) {
      Alert.alert('Missing name', 'This team name does not have two players listed.');
      return;
    }
    void saveSelection(pendingTeam, '2', name);
  };

  const cancelPlayerPick = () => setPendingTeam(null);

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.title}>Choose Your Team</Text>
      <Text style={styles.subtitle}>
        You will only be able to enter scores for games your team is playing.
      </Text>

      {pendingTeam && pendingPlayers ? (
        <View style={styles.pickerBox}>
          <Text style={styles.pickerTitle}>Who are you on this team?</Text>
          <Text style={styles.pickerTeam}>{pendingTeam}</Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
            <Pressable onPress={choosePlayer1} style={[styles.pickerBtn, { backgroundColor: 'black' }]}>
              <Text style={[styles.pickerBtnText, { color: 'white' }]}>{pendingPlayers.p1}</Text>
            </Pressable>

            <Pressable
              onPress={choosePlayer2}
              style={[styles.pickerBtn, { backgroundColor: pendingPlayers.p2 ? 'black' : '#999' }]}
              disabled={!pendingPlayers.p2}
            >
              <Text style={[styles.pickerBtnText, { color: 'white' }]}>
                {pendingPlayers.p2 || 'N/A'}
              </Text>
            </Pressable>

            <Pressable onPress={cancelPlayerPick} style={[styles.pickerBtn, styles.cancelBtn]}>
              <Text style={[styles.pickerBtnText, { color: 'black' }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Text style={styles.division}>Advanced Division</Text>
      {[
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
      ].map((team) => (
        <Pressable key={team} style={styles.button} onPress={() => beginChooseTeam(team)}>
          <Text style={styles.buttonText}>{team}</Text>
        </Pressable>
      ))}

      <Text style={styles.division}>Intermediate Division</Text>
      {[
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
      ].map((team) => (
        <Pressable key={team} style={styles.button} onPress={() => beginChooseTeam(team)}>
          <Text style={styles.buttonText}>{team}</Text>
        </Pressable>
      ))}

      <Text style={styles.division}>Beginner Division</Text>
      {[
        'Eric/Tracy',
        'Rachel/Jaime',
        'Amy/Ellen',
        'Lashonda/Lynette',
        'Michael/JP',
        'Fran/Scott',
        'Robert/Adam',
        'Cynthia/Maureen',
        'Marina/Sharon',
      ].map((team) => (
        <Pressable key={team} style={styles.button} onPress={() => beginChooseTeam(team)}>
          <Text style={styles.buttonText}>{team}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '800', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#444', marginBottom: 18 },

  pickerBox: {
    borderWidth: 1,
    borderColor: '#000',
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
    backgroundColor: '#fff',
  },
  pickerTitle: { fontSize: 16, fontWeight: '900' },
  pickerTeam: { marginTop: 6, fontSize: 14, color: '#444', fontWeight: '700' },
  pickerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { backgroundColor: 'white' },
  pickerBtnText: { fontWeight: '900' },

  division: { fontSize: 18, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  button: {
    backgroundColor: 'black',
    padding: 14,
    borderRadius: 10,
    marginBottom: 10,
  },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '700' },
});
