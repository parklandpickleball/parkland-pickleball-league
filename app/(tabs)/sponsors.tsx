import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import React, { useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

type Sponsor = {
  id: "diadem" | "ellie" | "zenov";
  name: string;
  website: string;
};

export default function SponsorsScreen() {
  // ✅ Sponsors (final)
  const sponsors: Sponsor[] = useMemo(
    () => [
      {
        id: "diadem",
        name: "Diadem",
        website: "https://diademsports.com/",
      },
      {
        id: "ellie",
        name: "Ellie Mental Health of Pembroke Pines, FL",
        website: "https://elliementalhealth.com/locations/pembroke-pines-fl/",
      },
      {
        id: "zenov",
        name: "Zenov BPO",
        website: "https://www.zenov-bpo.com/",
      },
    ],
    []
  );

  // ✅ Local logo images (from assets)
  // IMPORTANT: These files must exist:
  // assets/sponsors/diadem.png
  // assets/sponsors/ellie.png
  // assets/sponsors/zenov.png
  const logos = useMemo(
    () => ({
      diadem: require("../../assets/sponsors/diadem.png"),
      ellie: require("../../assets/sponsors/ellie.png"),
      zenov: require("../../assets/sponsors/zenov.png"),
    }),
    []
  );

  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const openWebsite = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // no crash
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Sponsors</ThemedText>
        <ThemedText style={styles.sub}>
          Tap a sponsor logo to visit their website.
        </ThemedText>
      </View>

      <View style={styles.list}>
        {sponsors.map((s) => {
          const logoSource = logos[s.id];
          const showFallback = failed[s.id] === true;

          return (
            <Pressable
              key={s.id}
              onPress={() => openWebsite(s.website)}
              style={styles.card}
            >
              <View style={styles.row}>
                <View style={styles.logoBox}>
                  {showFallback ? (
                    <ThemedText style={styles.logoFallback}>Logo</ThemedText>
                  ) : (
                    <Image
                      source={logoSource}
                      style={styles.logo}
                      resizeMode="contain"
                      onError={() =>
                        setFailed((prev) => ({ ...prev, [s.id]: true }))
                      }
                    />
                  )}
                </View>

                <View style={{ flex: 1, gap: 4 }}>
                  <ThemedText type="defaultSemiBold">{s.name}</ThemedText>
                  <ThemedText style={styles.link}>{s.website}</ThemedText>
                </View>

                <ThemedText style={styles.tap}>Tap</ThemedText>
              </View>
            </Pressable>
          );
        })}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  header: { gap: 6 },
  sub: { opacity: 0.8 },

  list: { gap: 12, marginTop: 4 },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },

  row: { flexDirection: "row", alignItems: "center", gap: 12 },

  logoBox: {
    width: 72,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },

  logo: {
    width: 64,
    height: 44,
  },

  logoFallback: { opacity: 0.6, fontSize: 12 },

  link: { opacity: 0.7, fontSize: 12 },

  tap: { opacity: 0.6, fontSize: 12 },
});
