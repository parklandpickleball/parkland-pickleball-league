// app/_photos_simple.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { supabase } from "@/constants/supabaseClient";

type StorageItem = {
  name: string;
  id?: string;
  updated_at?: string;
  created_at?: string;
  last_accessed_at?: string;
  metadata?: any;
};

type UploadRow = {
  path: string; // "shared/filename.jpg"
  uploader: string; // uid
  created_at: string;
};

const SHARED_FOLDER = "shared";
const BUCKET = "photos";

// ✅ UI/perf tuning knobs
const INITIAL_RENDER_COUNT = 60; // how many thumbnails to render initially
const LOAD_MORE_STEP = 60; // how many more each time
const LIST_LIMIT = 200; // how many to list from storage

export default function PhotosSimple() {
  const { width } = useWindowDimensions();

  const [status, setStatus] = useState<"signing_in" | "ready" | "error">(
    "signing_in"
  );
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const [userId, setUserId] = useState<string>("");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [items, setItems] = useState<StorageItem[]>([]);
  const [ownersByPath, setOwnersByPath] = useState<Record<string, string>>({});

  // ✅ Load-more state (only affects rendering)
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_RENDER_COUNT);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number>(-1);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const folderPrefix = SHARED_FOLDER;

  useEffect(() => {
    initAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Grid sizing (aim for 8–10 across on desktop)
  const grid = useMemo(() => {
    const gutter = 10;

    // Slightly bigger thumbnails than before
    // Keep them not-too-big so 8–10 can fit on common widths.
    const tileSize = Platform.OS === "web" ? 120 : 120;

    // Available width inside padding
    const available = Math.max(320, width - 24);

    // Estimate columns by fitting tiles + gutters
    const estimatedCols = Math.floor((available + gutter) / (tileSize + gutter));

    // Clamp: desktop/web = up to 10 across, mobile = up to 4 across
    const maxCols = Platform.OS === "web" ? 10 : 4;
    const minCols = Platform.OS === "web" ? 4 : 2;

    const numColumns = Math.max(minCols, Math.min(maxCols, estimatedCols || 1));

    // Calculate exact tile size so it fills cleanly
    const totalGutters = gutter * (numColumns - 1);
    const computedTile = Math.floor((available - totalGutters) / numColumns);

    // Cap tile size to avoid enormous tiles on ultra-wide screens
    const finalTile = Math.min(150, Math.max(100, computedTile));

    return { numColumns, tile: finalTile, gutter };
  }, [width]);

  async function initAuth() {
    try {
      setErr("");
      setStatus("signing_in");

      const { data: s1, error: e1 } = await supabase.auth.getSession();
      if (e1) throw e1;

      let uid = s1.session?.user?.id ?? "";

      if (!uid) {
        const { error: e2 } = await supabase.auth.signInAnonymously();
        if (e2) throw e2;

        const { data: s3, error: e3 } = await supabase.auth.getSession();
        if (e3) throw e3;

        uid = s3.session?.user?.id ?? "";
        if (!uid) throw new Error("Session still missing after anonymous sign-in.");
      }

      setUserId(uid);

      const { data: adminRow, error: adminErr } = await supabase
        .from("photo_admins")
        .select("user_id")
        .eq("user_id", uid)
        .maybeSingle();

      if (adminErr) throw adminErr;
      setIsAdmin(!!adminRow?.user_id);

      setStatus("ready");
      await refreshList();
    } catch (e: any) {
      setStatus("error");
      setErr(e?.message || String(e));
      console.log("AUTH ERROR:", e);
    }
  }

  function publicUrlForPath(path: string) {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }

  function itemPath(item: StorageItem) {
    return `${folderPrefix}/${item.name}`;
  }

  async function refreshList() {
    try {
      setBusy(true);
      setErr("");

      const { data, error } = await supabase.storage.from(BUCKET).list(folderPrefix, {
        limit: LIST_LIMIT,
        offset: 0,
        sortBy: { column: "name", order: "desc" },
      });
      if (error) throw error;

      const list = ((data as any) || []) as StorageItem[];
      setItems(list);

      // Reset visible thumbnails on refresh (keeps it fast)
      setVisibleCount(INITIAL_RENDER_COUNT);

      const paths = list.map((it) => itemPath(it));
      if (paths.length === 0) {
        setOwnersByPath({});
        return;
      }

      const { data: uploads, error: upErr } = await supabase
        .from("photo_uploads")
        .select("path,uploader,created_at")
        .in("path", paths);

      if (upErr) throw upErr;

      const map: Record<string, string> = {};
      (uploads as UploadRow[] | null)?.forEach((r) => {
        map[r.path] = r.uploader;
      });

      setOwnersByPath(map);
    } catch (e: any) {
      const msg = e?.message || String(e);
      setErr(msg);
      console.log("LIST ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  // ✅ MULTI-UPLOAD (WEB) still supported
  async function uploadOneWeb() {
    if (Platform.OS !== "web") return;
    if (!userId) return;

    try {
      setBusy(true);
      setErr("");

      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.multiple = true;

      input.onchange = async () => {
        try {
          const files = Array.from(input.files ?? []);
          if (!files.length) return;

          // Safety: if someone selects a huge number, do it in chunks
          const MAX_FILES_PER_RUN = 60;
          const chosen = files.slice(0, MAX_FILES_PER_RUN);

          for (const file of chosen) {
            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const safeExt = ext.match(/^[a-z0-9]+$/) ? ext : "jpg";

            const fileName = `${Date.now()}_${Math.random().toString(16).slice(2)}.${safeExt}`;
            const path = `${folderPrefix}/${fileName}`;

            const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
              cacheControl: "3600",
              upsert: false,
              contentType: file.type || "image/jpeg",
            });
            if (error) throw error;

            const { error: insErr } = await supabase.from("photo_uploads").insert({
              path,
              uploader: userId,
            });
            if (insErr) throw insErr;
          }

          await refreshList();
        } catch (e: any) {
          setErr(e?.message || String(e));
          console.log("UPLOAD ERROR:", e);
        } finally {
          setBusy(false);
        }
      };

      input.click();
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("UPLOAD INIT ERROR:", e);
      setBusy(false);
    }
  }

  function openViewerByIndex(index: number) {
    setViewerIndex(index);
    setViewerOpen(true);
    setConfirmingDelete(false);
  }

  function closeViewer() {
    setViewerOpen(false);
    setViewerIndex(-1);
    setConfirmingDelete(false);
  }

  const currentItem = useMemo(() => {
    if (viewerIndex < 0 || viewerIndex >= items.length) return null;
    return items[viewerIndex];
  }, [viewerIndex, items]);

  const currentPath = useMemo(() => {
    return currentItem ? itemPath(currentItem) : "";
  }, [currentItem]);

  const currentUrl = useMemo(() => {
    return currentPath ? publicUrlForPath(currentPath) : "";
  }, [currentPath]);

  const currentUploader = useMemo(() => {
    return currentPath ? ownersByPath[currentPath] || "" : "";
  }, [currentPath, ownersByPath]);

  const canDeleteCurrent = useMemo(() => {
    if (!userId || !currentPath) return false;
    if (isAdmin) return true;
    return !!currentUploader && currentUploader === userId;
  }, [userId, isAdmin, currentUploader, currentPath]);

  const hasPrev = viewerIndex > 0;
  const hasNext = viewerIndex >= 0 && viewerIndex < items.length - 1;

  // ✅ Arrow-key navigation on web while viewer is open
  useEffect(() => {
    if (!viewerOpen) return;
    if (Platform.OS !== "web") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!viewerOpen) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (hasPrev) openViewerByIndex(viewerIndex - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (hasNext) openViewerByIndex(viewerIndex + 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeViewer();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, viewerIndex, hasPrev, hasNext]);

  // ✅ Swipe left/right navigation (mobile-friendly)
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => {
        // Horizontal intent
        return Math.abs(gesture.dx) > Math.abs(gesture.dy) && Math.abs(gesture.dx) > 12;
      },
      onPanResponderRelease: (_evt, gesture) => {
        const SWIPE_THRESHOLD = 60;

        if (gesture.dx > SWIPE_THRESHOLD) {
          // swipe right -> previous
          if (hasPrev) openViewerByIndex(viewerIndex - 1);
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          // swipe left -> next
          if (hasNext) openViewerByIndex(viewerIndex + 1);
        }
      },
    })
  ).current;

  async function doDeleteNow() {
    if (!currentPath || !currentItem) return;

    try {
      setBusy(true);
      setErr("");

      const { error: delErr } = await supabase.storage.from(BUCKET).remove([currentPath]);
      if (delErr) throw delErr;

      const { error: rowDelErr } = await supabase
        .from("photo_uploads")
        .delete()
        .eq("path", currentPath);
      if (rowDelErr) throw rowDelErr;

      const nextIndex = Math.min(viewerIndex, Math.max(0, items.length - 2));
      await refreshList();
      setConfirmingDelete(false);

      if (items.length <= 1) {
        closeViewer();
      } else {
        setViewerIndex(nextIndex);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
      console.log("DELETE ERROR:", e);
    } finally {
      setBusy(false);
    }
  }

  // ✅ Render only a limited number, then “Load more”
  const visibleItems = useMemo(() => {
    return items.slice(0, visibleCount);
  }, [items, visibleCount]);

  const canLoadMore = visibleCount < items.length;

  function loadMore() {
    setVisibleCount((c) => Math.min(items.length, c + LOAD_MORE_STEP));
  }

  if (status === "signing_in") {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.sub}>&nbsp;Signing in...</Text>
      </View>
    );
  }

  if (status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>Sign-in failed</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}
        <Pressable style={styles.btn} onPress={initAuth}>
          <Text style={styles.btnText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Photos</Text>
        <Text style={styles.ok}>Signed in ✅ {isAdmin ? "(Admin)" : ""}</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}

        <View style={styles.row}>
          <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={refreshList} disabled={busy}>
            <Text style={styles.btnText}>Refresh List</Text>
          </Pressable>

          {Platform.OS === "web" && (
            <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={uploadOneWeb} disabled={busy}>
              <Text style={styles.btnText}>Upload (Web)</Text>
            </Pressable>
          )}
        </View>

        <Text style={styles.sub}>Folder: photos/{folderPrefix}/</Text>
        <Text style={styles.sub}>
          Tip: In the viewer you can use <Text style={{ fontWeight: "800" }}>← →</Text> keys (desktop) or swipe (mobile).
        </Text>
      </View>

      <FlatList
        data={visibleItems}
        keyExtractor={(it) => it.name}
        numColumns={grid.numColumns}
        columnWrapperStyle={grid.numColumns > 1 ? { gap: grid.gutter } : undefined}
        contentContainerStyle={{ paddingBottom: 24, gap: grid.gutter }}
        renderItem={({ item, index }) => {
          const actualIndex = index; // index within visibleItems matches first N of items
          const path = itemPath(item);
          const url = publicUrlForPath(path);

          return (
            <Pressable
              style={[
                styles.tile,
                {
                  width: grid.tile,
                  height: grid.tile + 28, // add space for filename
                },
              ]}
              onPress={() => openViewerByIndex(actualIndex)}
            >
              <Image
                source={{ uri: url }}
                style={[styles.tileImage, { width: grid.tile, height: grid.tile }]}
                resizeMode="cover"
              />
              <Text style={styles.tileText} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.sub}>No photos yet.</Text>
          </View>
        }
        ListFooterComponent={
          canLoadMore ? (
            <View style={{ paddingTop: 12 }}>
              <Pressable style={[styles.btn, busy && styles.btnDisabled]} onPress={loadMore} disabled={busy}>
                <Text style={styles.btnText}>Load More</Text>
              </Pressable>
              <Text style={styles.sub}>&nbsp;Showing {visibleItems.length} of {items.length}</Text>
            </View>
          ) : items.length > 0 ? (
            <View style={{ paddingTop: 12 }}>
              <Text style={styles.sub}>Showing all {items.length} photos.</Text>
            </View>
          ) : null
        }
      />

      <Modal visible={viewerOpen} animationType="fade" transparent onRequestClose={closeViewer} presentationStyle="overFullScreen">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {currentItem?.name || "Photo"}
              </Text>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  style={[styles.actionBtn, (!hasPrev || busy) && styles.btnDisabled]}
                  onPress={() => hasPrev && openViewerByIndex(viewerIndex - 1)}
                  disabled={!hasPrev || busy}
                >
                  <Text style={styles.actionText}>Prev</Text>
                </Pressable>

                <Pressable
                  style={[styles.actionBtn, (!hasNext || busy) && styles.btnDisabled]}
                  onPress={() => hasNext && openViewerByIndex(viewerIndex + 1)}
                  disabled={!hasNext || busy}
                >
                  <Text style={styles.actionText}>Next</Text>
                </Pressable>

                {canDeleteCurrent && !confirmingDelete && (
                  <Pressable
                    style={[styles.actionBtn, styles.deleteBtn, busy && styles.btnDisabled]}
                    onPress={() => setConfirmingDelete(true)}
                    disabled={busy}
                  >
                    <Text style={styles.actionText}>Delete</Text>
                  </Pressable>
                )}

                <Pressable style={[styles.actionBtn, busy && styles.btnDisabled]} onPress={closeViewer} disabled={busy}>
                  <Text style={styles.actionText}>Close</Text>
                </Pressable>
              </View>
            </View>

            {!!currentUrl && (
              <View style={styles.viewerBody} {...panResponder.panHandlers}>
                <Image source={{ uri: currentUrl }} style={styles.fullImage} resizeMode="contain" />
              </View>
            )}

            {canDeleteCurrent && confirmingDelete && (
              <View style={styles.confirmBar}>
                <Text style={styles.confirmText}>Confirm delete?</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <Pressable
                    style={[styles.actionBtn, styles.cancelBtn, busy && styles.btnDisabled]}
                    onPress={() => setConfirmingDelete(false)}
                    disabled={busy}
                  >
                    <Text style={styles.actionText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.actionBtn, styles.deleteBtn, busy && styles.btnDisabled]}
                    onPress={doDeleteNow}
                    disabled={busy}
                  >
                    <Text style={styles.actionText}>Confirm Delete</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  header: { marginBottom: 12, gap: 6 },
  title: { fontSize: 22, fontWeight: "700" },
  sub: { fontSize: 13, opacity: 0.8 },
  ok: { fontSize: 14, fontWeight: "700" },
  err: { fontSize: 13, color: "#cc0000" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },

  btn: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#111",
    alignSelf: "flex-start",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#fff", fontWeight: "600" },

  // ✅ Grid tile
  tile: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  tileImage: {
    backgroundColor: "#eee",
  },
  tileText: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: "700",
  },

  empty: { padding: 16, alignItems: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.75)",
    padding: 18,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    overflow: "hidden",
    maxHeight: "90%",
  },
  modalHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  modalTitle: { fontSize: 14, fontWeight: "700", flex: 1 },

  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "#111",
  },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  deleteBtn: { backgroundColor: "#b00020" },
  cancelBtn: { backgroundColor: "#333" },

  viewerBody: { width: "100%", backgroundColor: "#000" },
  fullImage: { width: "100%", height: 520, backgroundColor: "#000" },

  confirmBar: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  confirmText: { fontSize: 13, fontWeight: "700" },
});
