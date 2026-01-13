import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
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
  text: string;
  createdAt: number;
  author: string;
};

type Post = {
  id: string;
  type: "COMMUNITY";
  text: string;
  createdAt: number;
  author: string;
  replies: Reply[];
};

const STORAGE_KEY = "ppl_announcements_posts_v1";

// ✅ OFFICIAL badge image (Season 3 logo)
const OFFICIAL_BADGE_IMG = require("../../assets/images/ppl-season3-logo.png");

export default function AdminAnnouncementsScreen() {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");

  // Admin identity (admin posts are always authored as ADMIN)
  const currentAuthor = "ADMIN";

  // Inline reply UI state (one post at a time)
  const [replyingToPostId, setReplyingToPostId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const rawPosts = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed: any = rawPosts ? JSON.parse(rawPosts) : [];
        const list = Array.isArray(parsed) ? parsed : [];

        // Normalize posts + replies (back-compat safe)
        const normalized: Post[] = list.map((p: any) => {
          const author =
            typeof p.author === "string" && p.author.trim() ? p.author : "Unknown";

          const repliesRaw = Array.isArray(p.replies) ? p.replies : [];
          const replies: Reply[] = repliesRaw.map((r: any) => ({
            id: String(r.id ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`),
            text: String(r.text ?? ""),
            createdAt: Number(r.createdAt ?? Date.now()),
            author:
              typeof r.author === "string" && r.author.trim() ? r.author : "Unknown",
          }));

          return {
            id: String(p.id),
            type: "COMMUNITY",
            text: String(p.text ?? ""),
            createdAt: Number(p.createdAt ?? Date.now()),
            author,
            replies,
          };
        });

        if (mounted) setPosts(normalized);
      } catch {
        if (mounted) setPosts([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  async function persist(next: Post[]) {
    setPosts(next);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      Alert.alert("Save failed", "Could not save posts.");
    }
  }

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => b.createdAt - a.createdAt),
    [posts]
  );

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString();
  }

  // ✅ Admin screen: admin can delete ANY post/reply
  const canDeletePost = (_p: Post) => true;
  const canDeleteReply = (_r: Reply) => true;

  // 🔔 Admin-post notification trigger (ADMIN POSTS ONLY)
  // ✅ SDK 54-safe: uses scheduleNotificationAsync(trigger:null)
  async function triggerAdminPostNotification(message: string) {
    try {
      // Never on web
      if (Platform.OS === "web") return;

      // Ensure permission (local notifications on iOS still require permission)
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        finalStatus = req.status;
      }

      if (finalStatus !== "granted") {
        // Permission denied → do nothing (no blocking)
        return;
      }

      const body = message.length > 120 ? message.slice(0, 117) + "..." : message;

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "PPL Admin Announcement",
          body,
          sound: "default",
        },
        trigger: null, // immediate (foreground-safe with handler in _layout)
      });
    } catch {
      // silent fail
    }
  }

  async function onPost() {
    const trimmed = text.trim();
    if (!trimmed) return;

    const newPost: Post = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: "COMMUNITY",
      text: trimmed,
      createdAt: Date.now(),
      author: currentAuthor, // ✅ ADMIN posts only from here
      replies: [],
    };

    setText("");
    await persist([newPost, ...posts]);

    // ✅ ONLY admin-posted announcements trigger a notification
    await triggerAdminPostNotification(trimmed);
  }

  async function onDeletePost(post: Post) {
    const doDelete = async () => {
      const next = posts.filter((p) => p.id !== post.id);
      await persist(next);
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete this post?");
      if (!ok) return;
      await doDelete();
      return;
    }

    Alert.alert("Delete this post?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  }

  function startReply(postId: string) {
    if (replyingToPostId === postId) {
      setReplyingToPostId(null);
      setReplyText("");
      return;
    }
    setReplyingToPostId(postId);
    setReplyText("");
  }

  async function submitReply(postId: string) {
    const trimmed = replyText.trim();
    if (!trimmed) return;

    const newReply: Reply = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      text: trimmed,
      createdAt: Date.now(),
      author: currentAuthor, // replies from admin screen are ADMIN
    };

    const next = posts.map((p) => {
      if (p.id !== postId) return p;
      return { ...p, replies: [...(p.replies || []), newReply] };
    });

    setReplyText("");
    setReplyingToPostId(null);
    await persist(next);

    // 🚫 IMPORTANT: Replies do NOT trigger notifications
  }

  async function onDeleteReply(postId: string, reply: Reply) {
    const doDelete = async () => {
      const next = posts.map((p) => {
        if (p.id !== postId) return p;
        return { ...p, replies: (p.replies || []).filter((r) => r.id !== reply.id) };
      });
      await persist(next);
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete this reply?");
      if (!ok) return;
      await doDelete();
      return;
    }

    Alert.alert("Delete this reply?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  }

  const header = (
    <View style={styles.headerWrap}>
      <ThemedText type="title">Admin Announcements</ThemedText>

      <ThemedText style={styles.subtitle}>
        Post official announcements here. These appear in the community Announcements tab.
      </ThemedText>

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type an official announcement..."
          placeholderTextColor="#999"
          style={styles.input}
          multiline
        />

        <Pressable onPress={onPost} style={styles.postBtn}>
          <ThemedText>Post</ThemedText>
        </Pressable>
      </View>
    </View>
  );

  return (
    <ThemedView style={{ flex: 1 }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <FlatList
          data={sortedPosts}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => {
            const isAdminPost = item.author === "ADMIN";
            const headerLabel = isAdminPost ? "ADMIN" : "COMMUNITY";
            const displayAuthor = isAdminPost ? "ADMIN" : item.author;

            return (
              <View style={styles.card}>
                <View style={styles.cardTopRow}>
                  <View style={styles.leftHeaderRow}>
                    <ThemedText type="defaultSemiBold">{headerLabel}</ThemedText>

                    {isAdminPost ? (
                      <View style={styles.officialBadge}>
                        <Image source={OFFICIAL_BADGE_IMG} style={styles.officialBadgeImage} />
                      </View>
                    ) : null}
                  </View>

                  {canDeletePost(item) ? (
                    <Pressable onPress={() => onDeletePost(item)} style={styles.deletePill}>
                      <ThemedText>Delete</ThemedText>
                    </Pressable>
                  ) : null}
                </View>

                <ThemedText style={styles.author}>{displayAuthor}</ThemedText>

                <ThemedText>{item.text}</ThemedText>

                <View style={styles.actionRow}>
                  <Pressable onPress={() => startReply(item.id)} style={styles.replyPill}>
                    <ThemedText>{replyingToPostId === item.id ? "Cancel" : "Reply"}</ThemedText>
                  </Pressable>
                </View>

                {replyingToPostId === item.id ? (
                  <View style={styles.replyComposer}>
                    <TextInput
                      value={replyText}
                      onChangeText={setReplyText}
                      placeholder="Write a reply as ADMIN..."
                      placeholderTextColor="#999"
                      style={styles.replyInput}
                      multiline
                    />
                    <Pressable onPress={() => submitReply(item.id)} style={styles.replyPostBtn}>
                      <ThemedText>Post Reply</ThemedText>
                    </Pressable>
                  </View>
                ) : null}

                {item.replies && item.replies.length > 0 ? (
                  <View style={styles.repliesWrap}>
                    {item.replies
                      .slice()
                      .sort((a, b) => a.createdAt - b.createdAt)
                      .map((r) => (
                        <View key={r.id} style={styles.replyBubble}>
                          <View style={styles.replyTopRow}>
                            <ThemedText style={styles.replyAuthor}>{r.author}</ThemedText>

                            {canDeleteReply(r) ? (
                              <Pressable
                                onPress={() => onDeleteReply(item.id, r)}
                                style={styles.replyDeletePill}
                              >
                                <ThemedText>Delete</ThemedText>
                              </Pressable>
                            ) : null}
                          </View>

                          <ThemedText style={styles.replyText}>{r.text}</ThemedText>
                          <ThemedText style={styles.replyTime}>{formatTime(r.createdAt)}</ThemedText>
                        </View>
                      ))}
                  </View>
                ) : null}

                <ThemedText style={styles.time}>{formatTime(item.createdAt)}</ThemedText>
              </View>
            );
          }}
          ListEmptyComponent={
            loading ? null : (
              <ThemedText style={{ opacity: 0.6, marginTop: 12 }}>
                No posts yet. Post an official announcement above.
              </ThemedText>
            )
          }
        />
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  headerWrap: { gap: 10, marginBottom: 10 },
  subtitle: { opacity: 0.8 },

  composer: { flexDirection: "row", gap: 10, alignItems: "flex-end" },

  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    color: "#000",
  },

  postBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginTop: 10,
  },

  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    justifyContent: "space-between",
  },

  leftHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  officialBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    opacity: 0.95,
    shadowColor: "#00AEEF",
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  officialBadgeImage: {
    width: "100%",
    height: "100%",
  },

  deletePill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  author: {
    opacity: 0.75,
    fontSize: 12,
  },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },

  replyPill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: "flex-start",
  },

  replyComposer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 10,
    marginTop: 6,
  },

  replyInput: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    color: "#000",
  },

  replyPostBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },

  repliesWrap: {
    marginTop: 6,
    gap: 8,
    paddingLeft: 14,
  },

  replyBubble: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
  },

  replyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

  replyAuthor: {
    fontSize: 12,
    opacity: 0.8,
  },

  replyDeletePill: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    opacity: 0.9,
  },

  replyText: {
    fontSize: 14,
  },

  replyTime: {
    opacity: 0.5,
    fontSize: 11,
  },

  time: { opacity: 0.5, fontSize: 12, marginTop: 4 },
});
