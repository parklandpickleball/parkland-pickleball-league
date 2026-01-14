import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { supabaseHeaders, supabaseRestUrl } from "@/constants/supabase";
import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View
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
  author: string;
  message: string;
  created_at: string;
  replies: Reply[];
};

const OFFICIAL_BADGE_IMG = require("../../assets/images/ppl-season3-logo.png");

export default function AnnouncementsScreen() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const author = "Community";

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const res = await fetch(
      supabaseRestUrl("/announcements?scope=eq.community&order=created_at.desc"),
      { headers: supabaseHeaders() }
    );
    const announcements = await res.json();

    if (!Array.isArray(announcements)) {
      setPosts([]);
      return;
    }

    if (announcements.length === 0) {
      setPosts([]);
      return;
    }

    const ids = announcements.map((a) => a.id).join(",");

    const replyRes = await fetch(
      supabaseRestUrl(
        `/announcement_replies?announcement_id=in.(${ids})&order=created_at.asc`
      ),
      { headers: supabaseHeaders() }
    );
    const replies: Reply[] = await replyRes.json();

    const grouped: Record<string, Reply[]> = {};
    replies.forEach((r) => {
      if (!grouped[r.announcement_id]) grouped[r.announcement_id] = [];
      grouped[r.announcement_id].push(r);
    });

    setPosts(
      announcements.map((a) => ({
        ...a,
        replies: grouped[a.id] || [],
      }))
    );
  }

  async function postAnnouncement() {
    if (!text.trim()) return;

    await fetch(supabaseRestUrl("/announcements"), {
      method: "POST",
      headers: supabaseHeaders(),
      body: JSON.stringify({
        scope: "community",
        author,
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
        author,
        message: replyText.trim(),
      }),
    });

    setReplyText("");
    setReplyingTo(null);
    loadAll();
  }

  async function deletePost(id: string) {
    await fetch(supabaseRestUrl(`/announcements?id=eq.${id}`), {
      method: "DELETE",
      headers: supabaseHeaders(),
    });
    loadAll();
  }

  async function deleteReply(id: string) {
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
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <ThemedText type="defaultSemiBold">COMMUNITY</ThemedText>
                <Pressable onPress={() => deletePost(item.id)}>
                  <ThemedText>Delete</ThemedText>
                </Pressable>
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

              {item.replies.map((r) => (
                <View key={r.id} style={styles.replyBubble}>
                  <ThemedText>{r.author}</ThemedText>
                  <ThemedText>{r.message}</ThemedText>
                  <Pressable onPress={() => deleteReply(r.id)}>
                    <ThemedText>Delete</ThemedText>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
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
  cardTopRow: { flexDirection: "row", justifyContent: "space-between" },
  author: { fontSize: 12, opacity: 0.7 },
  replyComposer: { marginTop: 6, gap: 6 },
  replyBubble: { borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 6 },
});
