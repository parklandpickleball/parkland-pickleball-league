import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { SUPABASE_URL, supabaseHeaders } from "@/constants/supabase";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Modal, Platform, Pressable, StyleSheet, View } from "react-native";

type PhotoItem = {
  id: string; // storage object "name" (full path inside bucket)
  name: string; // filename only
  dataUrl: string; // public URL
  createdAt: number; // ms
  uploadedBy: string; // prefix folder (team::playerIndex)
};

const STORAGE_KEY_TEAM = "ppl_selected_team";
const STORAGE_KEY_PLAYER_INDEX = "ppl_selected_player_index";
const ADMIN_UNLOCK_KEY = "ppl_admin_unlocked";

const BUCKET = "photos";

function storagePublicUrl(objectName: string) {
  // Supabase storage public URL format
  // NOTE: bucket must be public for images to display without auth
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${encodeURI(objectName)}`;
}

function storageObjectUrl(objectName: string) {
  return `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURI(objectName)}`;
}

function storageListUrl() {
  return `${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`;
}

function baseName(p: string) {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

function uploaderFromObjectName(objectName: string) {
  // we store uploads as: "<uploadedBy>/<filename>"
  const parts = objectName.split("/");
  return parts[0] || "unknown";
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_").trim();
}

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [uploadedBy, setUploadedBy] = useState<string>("unknown");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);

  const canDelete = (p: PhotoItem) => {
    if (isAdmin) return true;
    return p.uploadedBy === uploadedBy;
  };

  const loadPhotos = async () => {
    try {
      setLoading(true);

      const res = await fetch(storageListUrl(), {
        method: "POST",
        headers: {
          ...supabaseHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prefix: "", // list everything
          limit: 1000,
          offset: 0,
          sortBy: { column: "created_at", order: "desc" },
        }),
      });

      if (!res.ok) {
        throw new Error(`List failed: ${res.status}`);
      }

      const json = await res.json();
      const list = Array.isArray(json) ? json : [];

      const mapped: PhotoItem[] = list
        .filter((o: any) => typeof o?.name === "string" && o.name.length > 0)
        .map((o: any) => {
          const objName = String(o.name);
          const created =
            typeof o?.created_at === "string"
              ? Date.parse(o.created_at)
              : typeof o?.updated_at === "string"
              ? Date.parse(o.updated_at)
              : Date.now();

          return {
            id: objName,
            name: baseName(objName),
            dataUrl: storagePublicUrl(objName),
            createdAt: Number.isFinite(created) ? created : Date.now(),
            uploadedBy: uploaderFromObjectName(objName),
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt);

      setPhotos(mapped);
    } catch (e: any) {
      setPhotos([]);
      Platform.OS === "web"
        ? window.alert(`Failed to load photos.\n${String(e?.message || e)}`)
        : Alert.alert("Failed to load photos", String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [team, playerIndex, adminUnlocked] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_TEAM),
          AsyncStorage.getItem(STORAGE_KEY_PLAYER_INDEX),
          AsyncStorage.getItem(ADMIN_UNLOCK_KEY),
        ]);

        const who =
          (team ? team : "unknown-team") + "::" + (playerIndex ? playerIndex : "0");

        if (!mounted) return;

        setUploadedBy(who);
        setIsAdmin(adminUnlocked === "true");
      } catch {
        if (!mounted) return;
        setUploadedBy("unknown");
        setIsAdmin(false);
      } finally {
        if (!mounted) return;
        await loadPhotos();
      }
    })();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPressUpload = () => {
    if (Platform.OS === "web") {
      fileInputRef.current?.click();
      return;
    }

    Alert.alert(
      "Phone Upload Not Enabled Yet",
      "Phone uploads will be enabled next."
    );
  };

  const onWebPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // store inside bucket as "<uploadedBy>/<timestamp>_<random>_<filename>"
      const ts = Date.now();
      const rand = Math.random().toString(16).slice(2);
      const filename = safeFilename(file.name || "photo.jpg");
      const objectName = `${uploadedBy}/${ts}_${rand}_${filename}`;

      const upRes = await fetch(storageObjectUrl(objectName), {
        method: "POST",
        headers: {
          ...supabaseHeaders({
            "Content-Type": file.type || "application/octet-stream",
            "x-upsert": "true",
          }),
        },
        body: file,
      });

      if (!upRes.ok) {
        const txt = await upRes.text().catch(() => "");
        throw new Error(`Upload failed (${upRes.status}): ${txt}`);
      }

      await loadPhotos();
    } catch (err: any) {
      Platform.OS === "web"
        ? window.alert(`Upload failed.\n${String(err?.message || err)}`)
        : Alert.alert("Upload failed", String(err?.message || err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deletePhoto = async (p: PhotoItem) => {
    if (!canDelete(p)) {
      Platform.OS === "web"
        ? window.alert("You can only delete photos you uploaded.")
        : Alert.alert("Not allowed", "You can only delete photos you uploaded.");
      return;
    }

    const doDelete = async () => {
      try {
        const delRes = await fetch(storageObjectUrl(p.id), {
          method: "DELETE",
          headers: {
            ...supabaseHeaders(),
          },
        });

        if (!delRes.ok) {
          const txt = await delRes.text().catch(() => "");
          throw new Error(`Delete failed (${delRes.status}): ${txt}`);
        }

        // fast UI update + keep synced
        setPhotos((prev) => prev.filter((x) => x.id !== p.id));
      } catch (err: any) {
        Platform.OS === "web"
          ? window.alert(`Delete failed.\n${String(err?.message || err)}`)
          : Alert.alert("Delete failed", String(err?.message || err));
      }
    };

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete photo?");
      if (!ok) return;
      await doDelete();
      return;
    }

    Alert.alert("Delete photo?", "", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void doDelete() },
    ]);
  };

  const sortedPhotos = useMemo(
    () => [...photos].sort((a, b) => b.createdAt - a.createdAt),
    [photos]
  );

  const openLightbox = (p: PhotoItem) => {
    setSelectedPhoto(p);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
    setSelectedPhoto(null);
  };

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title">Photos</ThemedText>

      <Pressable onPress={onPressUpload} style={styles.button}>
        <ThemedText>Upload Photo</ThemedText>
      </Pressable>

      {Platform.OS === "web" ? (
        <input
          ref={(el) => {
            fileInputRef.current = el;
          }}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={onWebPickFile}
        />
      ) : null}

      {loading ? (
        <ThemedText style={styles.empty}>Loading…</ThemedText>
      ) : sortedPhotos.length === 0 ? (
        <ThemedText style={styles.empty}>No photos yet.</ThemedText>
      ) : (
        <View style={styles.grid}>
          {sortedPhotos.map((img) => (
            <View key={img.id} style={styles.gridCard}>
              <Pressable onPress={() => openLightbox(img)} style={styles.photoFrame}>
                {/* eslint-disable-next-line */}
                <img src={img.dataUrl} alt={img.name} style={styles.webImg} />
              </Pressable>

              <View style={styles.metaRow}>
                <View style={{ flex: 1 }}>
                  <ThemedText style={styles.webName} numberOfLines={1}>
                    {img.name}
                  </ThemedText>
                </View>

                <Pressable
                  onPress={() => deletePhoto(img)}
                  style={[
                    styles.deleteBtn,
                    !canDelete(img) && styles.deleteBtnDisabled,
                  ]}
                >
                  <ThemedText>Delete</ThemedText>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      <Modal
        visible={lightboxOpen}
        transparent
        animationType="fade"
        onRequestClose={closeLightbox}
      >
        <Pressable style={styles.lightboxBackdrop} onPress={closeLightbox}>
          <Pressable
            style={styles.lightboxCard}
            onPress={(e) => {
              // prevent closing when clicking inside
              // @ts-ignore
              e.stopPropagation?.();
            }}
          >
            <View style={styles.lightboxHeader}>
              <View style={{ flex: 1 }}>
                <ThemedText style={styles.lightboxTitle} numberOfLines={1}>
                  {selectedPhoto?.name || "Photo"}
                </ThemedText>
              </View>

              <Pressable onPress={closeLightbox} style={styles.closeBtn}>
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </Pressable>
            </View>

            <View style={styles.lightboxImageWrap}>
              {selectedPhoto ? (
                /* eslint-disable-next-line */
                <img
                  src={selectedPhoto.dataUrl}
                  alt={selectedPhoto.name}
                  style={styles.lightboxImg}
                />
              ) : null}
            </View>

            <ThemedText style={styles.lightboxHint}>
              Tip: you can screenshot this view.
            </ThemedText>
          </Pressable>
        </Pressable>
      </Modal>
    </ThemedView>
  );
}

const CARD_WIDTH = 260;

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },

  button: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },

  gridCard: {
    width: CARD_WIDTH,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 10,
  },

  photoFrame: {
    width: "100%",
    height: 180,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },

  webImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain" as any,
    borderRadius: 12,
    display: "block",
    cursor: "pointer",
  } as any,

  metaRow: { flexDirection: "row", alignItems: "center", gap: 10 },

  webName: { fontSize: 12, opacity: 0.85 },

  deleteBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },

  deleteBtnDisabled: { opacity: 0.35 },

  empty: { opacity: 0.7 },

  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },

  lightboxCard: {
    width: "100%",
    maxWidth: 900,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },

  lightboxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  lightboxTitle: { fontSize: 14, opacity: 0.9 },

  closeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  closeText: { fontSize: 16, opacity: 0.9 },

  lightboxImageWrap: {
    width: "100%",
    height: 520,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },

  lightboxImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain" as any,
    display: "block",
  } as any,

  lightboxHint: { fontSize: 12, opacity: 0.7 },
});
