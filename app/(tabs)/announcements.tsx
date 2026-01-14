import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { supabaseHeaders, supabaseRestUrl } from "@/constants/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

type Reply = {
  id: string;
  announcement_id: string;
  author: string;
  message: string;
  created_at: string;
};

type Post = {
  id: string;
  scope: "community" | "admin";
  author: string;
  message: string;
  created_at: string;
  replies: Reply[];
};

const OFFICIAL_BADGE_IMG = require("../../assets/images/ppl-season3-logo 2.png");

export default function AnnouncementsScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const [currentAuthor, setCurrentAuthor] = useState<string>("Community");

  useEffect(() => {
    (async () => {
      await loadAuthor();
      await loadAll();
    })();
  }, []);

  async function loadAuthor() {
    try {
      const name = (await AsyncStorage.getItem("ppl_selected_player_name"))?.trim() || "";
      const team = (await AsyncStorage.getItem("ppl_selected_team"))?.trim() || "";

      if (name && team) {
        setCurrentAuthor(`${name} (${team})`);
        return;
      }
      if (name) {
        setCurrentAuthor(name);
        return;
      }

      setCurrentAuthor("Community");
    } catch {
      setCurrentAuthor("Community");
    }
  }

  async function loadAll() {
    const res = await fetch(
      supabaseRestUrl("/announcements?scope=in.(community,admin)&order=created_at.desc"),
      { headers: supabaseHeaders() }
    );
    const announcements = await res.json();

    if (!Array.isArray(announcements) || announcements.length === 0) {
      setPosts([]);
      return;
    }

    const ids = announcements.map((a) => a.id).join(",");

    const replyRes = await fetch(
      supabaseRestUrl(`/announcement_replies?announcement_id=in.(${ids})&order=created_at.asc`),
      { headers: supabaseHeaders() }
    );
    const replies: Reply[] = await replyRes.json();

    const grouped: Record<string, Reply[]> = {};
    if (Array.isArray(replies)) {
      replies.forEach((r) => {
        if (!grouped[r.announcement_id]) grouped[r.announcement_id] = [];
        grouped[r.announcement_id].push(r);
      });
    }

    setPosts(
      announcements.map((a) => ({
        ...a,
        replies: grouped[a.id] || [],
      }))
    );
  }

  // ✅ Community users can delete ONLY their own items
  const canDeletePost = (p: Post) => {
    // If you’re browsing as ADMIN for any reason, allow it
    if (currentAuthor === "ADMIN") return true;

    // Community tab: only allow deleting community posts that match your author string
    return p.scope === "community" && p.author === currentAuthor;
  };

  const canDeleteReply = (r: Reply) => {
    if (currentAuthor === "ADMIN") return true;
    return r.author === currentAuthor;
  };

  async function postAnnouncement() {
    if (!text.trim()) return;

    await fetch(supabaseRestUrl("/announcements"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        scope: "community",
        author: currentAuthor,
        message: text.trim(),
      }),
    });

    setText("");
    loadAll();
  }

  async function postReply(postId: string) {
    if (!replyText.trim()) return;

    await fetch(supabaseRestUrl("/announcement_replies"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        announcement_id: postId,
        author: currentAuthor,
        message: replyText.trim(),
      }),
    });

    setReplyText("");
    setReplyingTo(null);
    loadAll();
  }

  async function deletePost(id: string, post: Post) {
    if (!canDeletePost(post)) return;

    await fetch(supabaseRestUrl(`/announcements?id=eq.${id}`), {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    loadAll();
  }

  async function deleteReply(id: string, reply: Reply) {
    if (!canDeleteReply(reply)) return;

    await fetch(supabaseRestUrl(`/announcement_replies?id=eq.${id}`), {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    loadAll();
  }

  const sorted = useMemo(
    () => [...posts].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [posts]
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={sorted}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: 16 }}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              <ThemedText type="title">Announcements</ThemedText>

              <View style={styles.composer}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder="Type a message..."
                  style={styles.input}
                  multiline
                />
                <Pressable onPress={postAnnouncement} style={styles.postBtn}>
                  <ThemedText>Post</ThemedText>
                </Pressable>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const isAdminPost = item.scope === "admin";

            return (
              <View style={styles.card}>
                <View style={styles.cardTopRow}>
                  {isAdminPost ? (
                    <View style={styles.adminBadge}>
                      <Image source={OFFICIAL_BADGE_IMG} style={styles.badgeImg} />
                      <ThemedText type="defaultSemiBold">ADMIN</ThemedText>
                    </View>
                  ) : (
                    <ThemedText type="defaultSemiBold">COMMUNITY</ThemedText>
                  )}

                  {canDeletePost(item) ? (
                    <Pressable onPress={() => deletePost(item.id, item)}>
                      <ThemedText>Delete</ThemedText>
                    </Pressable>
                  ) : null}
                </View>

                <ThemedText style={styles.author}>{item.author}</ThemedText>
                <ThemedText>{item.message}</ThemedText>

                <Pressable onPress={() => setReplyingTo(item.id)}>
                  <ThemedText>Reply</ThemedText>
                </Pressable>

                {replyingTo === item.id && (
                  <View style={styles.replyComposer}>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write a reply..."
                      style={styles.input}
                      multiline
                    />
                    <Pressable onPress={() => postReply(item.id)}>
                      <ThemedText>Post Reply</ThemedText>
                    </Pressable>
                  </View>
                )}

                {item.replies.map((r) => {
                  const isAdminReply = r.author === "ADMIN";

                  return (
                    <View key={r.id} style={styles.replyBubble}>
                      <View style={styles.replyTopRow}>
                        {isAdminReply ? (
                          <View style={styles.adminBadge}>
                            <Image source={OFFICIAL_BADGE_IMG} style={styles.badgeImg} />
                            <ThemedText type="defaultSemiBold">ADMIN</ThemedText>
                          </View>
                        ) : (
                          <ThemedText>{r.author}</ThemedText>
                        )}

                        {canDeleteReply(r) ? (
                          <Pressable onPress={() => deleteReply(r.id, r)}>
                            <ThemedText>Delete</ThemedText>
                          </Pressable>
                        ) : null}
                      </View>

                      <ThemedText>{r.message}</ThemedText>
                    </View>
                  );
                })}
              </View>
            );
          }}
        />
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerWrap: { gap: 10, marginBottom: 10 },
  composer: { flexDirection: "row", gap: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10 },
  postBtn: { borderWidth: 1, borderRadius: 12, padding: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6, marginTop: 10 },
  cardTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  author: { fontSize: 12, opacity: 0.7 },

  adminBadge: { flexDirection: "row", alignItems: "center", gap: 8 },
  badgeImg: { width: 18, height: 18, borderRadius: 9 },

  replyComposer: { marginTop: 6, gap: 6 },
  replyBubble: { borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 6 },
  replyTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
});
