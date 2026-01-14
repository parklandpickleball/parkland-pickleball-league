import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";

import { supabaseHeaders, supabaseRestUrl } from "@/constants/supabase";

type SponsorRow = {
  id: string;
  name: string;
  website: string;
  is_active: boolean;
  sort_order: number;
};

export default function SponsorsScreen() {
  const [sponsors, setSponsors] = useState<SponsorRow[]>([]);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Local logos (unchanged)
  const logos = useMemo(
    () => ({
      Diadem: require("../../assets/sponsors/diadem.png"),
      "Ellie Mental Health of Pembroke Pines, FL": require("../../assets/sponsors/ellie.png"),
      "Zenov BPO": require("../../assets/sponsors/zenov.png"),
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          supabaseRestUrl(
            "sponsors?select=id,name,website,is_active,sort_order&is_active=eq.true&order=sort_order.asc"
          ),
          { headers: supabaseHeaders() }
        );

        if (!res.ok) throw new Error("Failed to load sponsors");
        const rows = (await res.json()) as SponsorRow[];
        setSponsors(rows);
      } catch {
        setSponsors([]);
      }
    })();
  }, []);

  const openWebsite = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {}
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
          const logoSource = logos[s.name as keyof typeof logos];
          const showFallback = failed[s.id] || !logoSource;

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
  card: { borderWidth: 1, borderRadius: 12, padding: 12 },
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
  logo: { width: 64, height: 44 },
  logoFallback: { opacity: 0.6, fontSize: 12 },
  link: { opacity: 0.7, fontSize: 12 },
  tap: { opacity: 0.6, fontSize: 12 },
});
