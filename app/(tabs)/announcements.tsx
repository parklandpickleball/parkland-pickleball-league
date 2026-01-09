import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    TextInput,
    View,
} from "react-native";

type PostType = "COMMUNITY" | "OFFICIAL";

type Reply = {
  id: string;
  text: string;
  createdAt: number;
  author: string;
};

type Post = {
  id: string;
  type: PostType;
  text: string;
  createdAt: number;
  author: string;
  replies: Reply[]; // ✅ NEW
};

const STORAGE_KEY = "ppl_announcements_posts_v1";
const ADMIN_UNLOCK_KEY = "ppl_announcements_admin_unlocked_v1";

// Identity keys (from app/team.tsx)
const STORAGE_KEY_TEAM = "ppl_selected_team";
const STORAGE_KEY_PLAYER_NAME = "ppl_selected_player_name";

/**
 * 🔒 Admin Code (temporary)
 */
const ADMIN_CODE = "PPL2026";

export default function AnnouncementsScreen() {
  const [loading, setLoading] = useState(true);
  const [posts, setPosts] = useState<Post[]>([]);
  const [text, setText] = useState("");
  const [postType, setPostType] = useState<PostType>("COMMUNITY");

  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [adminCodeInput, setAdminCodeInput] = useState("");

  // Current identity
  const [currentAuthor, setCurrentAuthor] = useState<string>("Unknown");

  // Inline reply UI state (one post at a time)
  const [replyingToPostId, setReplyingToPostId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [rawPosts, rawAdmin, team, playerName] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY),
          AsyncStorage.getItem(ADMIN_UNLOCK_KEY),
          AsyncStorage.getItem(STORAGE_KEY_TEAM),
          AsyncStorage.getItem(STORAGE_KEY_PLAYER_NAME),
        ]);

        const parsed: any = rawPosts ? JSON.parse(rawPosts) : [];
        const list = Array.isArray(parsed) ? parsed : [];

        const name = (playerName || "").trim();
        const teamName = (team || "").trim();
        const who =
          name && teamName ? `${name} (${teamName})` : name ? name : "Unknown";

        // Back-compat normalization:
        // - ensure author exists
        // - ensure replies exists and is an array
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
            type: (p.type === "OFFICIAL" ? "OFFICIAL" : "COMMUNITY") as PostType,
            text: String(p.text ?? ""),
            createdAt: Number(p.createdAt ?? Date.now()),
            author,
            replies,
          };
        });

        if (mounted) {
          setPosts(normalized);
          setIsAdminUnlocked(rawAdmin === "true");
          setCurrentAuthor(who);
        }
      } catch {
        if (mounted) {
          setPosts([]);
          setIsAdminUnlocked(false);
          setCurrentAuthor("Unknown");
        }
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

  async function persistAdminUnlocked(value: boolean) {
    setIsAdminUnlocked(value);
    try {
      await AsyncStorage.setItem(ADMIN_UNLOCK_KEY, value ? "true" : "false");
    } catch {
      // keep in memory
    }
  }

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => b.createdAt - a.createdAt),
    [posts]
  );

  function formatTime(ms: number) {
    return new Date(ms).toLocaleString();
  }

  const canDeletePost = (p: Post) => {
    if (isAdminUnlocked) return true;
    return p.author === currentAuthor;
  };

  const canDeleteReply = (r: Reply) => {
    if (isAdminUnlocked) return true;
    return r.author === currentAuthor;
  };

  async function onPost() {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (postType === "OFFICIAL" && !isAdminUnlocked) {
      Alert.alert(
        "Admins only",
        "To post OFFICIAL announcements, enter the Admin Code first."
      );
      return;
    }

    const newPost: Post = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      type: postType,
      text: trimmed,
      createdAt: Date.now(),
      author: currentAuthor || "Unknown",
      replies: [],
    };

    setText("");
    await persist([newPost, ...posts]);
  }

  async function onClearAll() {
    Alert.alert("Clear all posts?", "This only clears this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: () => persist([]) },
    ]);
  }

  async function onUnlockAdmin() {
    const code = adminCodeInput.trim();
    if (!code) return;

    if (code === ADMIN_CODE) {
      setAdminCodeInput("");
      await persistAdminUnlocked(true);
      Alert.alert("Unlocked", "This device can now post OFFICIAL announcements.");
    } else {
      Alert.alert("Wrong code", "That Admin Code is not correct.");
    }
  }

  async function onLockAdmin() {
    Alert.alert(
      "Lock admin mode?",
      "This device will no longer be able to post OFFICIAL announcements.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock",
          style: "destructive",
          onPress: async () => {
            await persistAdminUnlocked(false);
          },
        },
      ]
    );
  }

  async function onDeletePost(post: Post) {
    if (!canDeletePost(post)) {
      Alert.alert("Not allowed", "You can only delete your own posts.");
      return;
    }

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
    // toggle
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
      author: currentAuthor || "Unknown",
    };

    const next = posts.map((p) => {
      if (p.id !== postId) return p;
      return { ...p, replies: [...(p.replies || []), newReply] };
    });

    setReplyText("");
    setReplyingToPostId(null);
    await persist(next);
  }

  async function onDeleteReply(postId: string, reply: Reply) {
    if (!canDeleteReply(reply)) {
      Alert.alert("Not allowed", "You can only delete your own replies.");
      return;
    }

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
      <ThemedText type="title">Announcements</ThemedText>

      <ThemedText style={styles.subtitle}>
        Post updates and community messages here. (Push alerts are next after
        admin-only OFFICIAL is locked.)
      </ThemedText>

      <View style={styles.typeRow}>
        <Pressable
          onPress={() => setPostType("COMMUNITY")}
          style={[
            styles.typePill,
            postType === "COMMUNITY" && styles.typePillActive,
          ]}
        >
          <ThemedText>Community</ThemedText>
        </Pressable>

        <Pressable
          onPress={() => setPostType("OFFICIAL")}
          style={[
            styles.typePill,
            postType === "OFFICIAL" && styles.typePillActive,
          ]}
        >
          <ThemedText>Official</ThemedText>
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable onPress={onClearAll}>
          <ThemedText>Clear</ThemedText>
        </Pressable>
      </View>

      {postType === "OFFICIAL" && !isAdminUnlocked ? (
        <View style={styles.adminRow}>
          <TextInput
            value={adminCodeInput}
            onChangeText={setAdminCodeInput}
            placeholder="Admin Code (admins only)"
            placeholderTextColor="#999"
            style={styles.adminInput}
            autoCapitalize="characters"
            autoCorrect={false}
            secureTextEntry={true}
          />
          <Pressable onPress={onUnlockAdmin} style={styles.adminBtn}>
            <ThemedText>Unlock</ThemedText>
          </Pressable>
        </View>
      ) : null}

      {isAdminUnlocked ? (
        <View style={styles.adminUnlockedRow}>
          <ThemedText style={styles.adminUnlockedText}>
            Admin unlocked on this device ✅
          </ThemedText>
          <Pressable onPress={onLockAdmin} style={styles.lockBtn}>
            <ThemedText>Lock</ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message..."
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
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          data={sortedPosts}
          keyExtractor={(i) => i.id}
          ListHeaderComponent={header}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <ThemedText type="defaultSemiBold">
                  {item.type === "OFFICIAL" ? "OFFICIAL" : "COMMUNITY"}
                </ThemedText>

                {canDeletePost(item) ? (
                  <Pressable
                    onPress={() => onDeletePost(item)}
                    style={styles.deletePill}
                  >
                    <ThemedText>Delete</ThemedText>
                  </Pressable>
                ) : null}
              </View>

              <ThemedText style={styles.author}>{item.author}</ThemedText>

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
                    placeholder="Write a reply..."
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
          )}
          ListEmptyComponent={
            loading ? null : (
              <ThemedText style={{ opacity: 0.6, marginTop: 12 }}>
                No posts yet. Type a message above and tap Post.
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

  typeRow: { flexDirection: "row", gap: 8, alignItems: "center" },

  typePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },

  typePillActive: { backgroundColor: "rgba(0,0,0,0.05)" },

  adminRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },

  adminInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: "#000",
  },

  adminBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },

  adminUnlockedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  adminUnlockedText: {
    opacity: 0.75,
  },

  lockBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

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
