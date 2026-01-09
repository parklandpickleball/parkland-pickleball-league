import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    Alert,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from "react-native";

type PhotoItem = {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
  uploadedBy: string;
};

const STORAGE_KEY_PHOTOS = "ppl_photos_v1";
const STORAGE_KEY_TEAM = "ppl_selected_team";
const STORAGE_KEY_PLAYER_INDEX = "ppl_selected_player_index";
const ADMIN_UNLOCK_KEY = "ppl_admin_unlocked";

export default function PhotosScreen() {
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [uploadedBy, setUploadedBy] = useState<string>("unknown");
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ✅ Lightbox state
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoItem | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const [rawPhotos, team, playerIndex, adminUnlocked] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_PHOTOS),
          AsyncStorage.getItem(STORAGE_KEY_TEAM),
          AsyncStorage.getItem(STORAGE_KEY_PLAYER_INDEX),
          AsyncStorage.getItem(ADMIN_UNLOCK_KEY),
        ]);

        const who =
          (team ? team : "unknown-team") +
          "::" +
          (playerIndex ? playerIndex : "0");

        const parsed = rawPhotos ? JSON.parse(rawPhotos) : [];
        const list: PhotoItem[] = Array.isArray(parsed) ? parsed : [];

        if (mounted) {
          setUploadedBy(who);
          setIsAdmin(adminUnlocked === "true");
          setPhotos(list.sort((a, b) => b.createdAt - a.createdAt));
        }
      } catch {
        if (mounted) {
          setUploadedBy("unknown");
          setIsAdmin(false);
          setPhotos([]);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const persist = async (next: PhotoItem[]) => {
    const sorted = [...next].sort((a, b) => b.createdAt - a.createdAt);
    setPhotos(sorted);
    try {
      await AsyncStorage.setItem(STORAGE_KEY_PHOTOS, JSON.stringify(sorted));
    } catch {
      Platform.OS === "web"
        ? window.alert("Save failed.")
        : Alert.alert("Save failed");
    }
  };

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

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;

      const newItem: PhotoItem = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: file.name,
        dataUrl,
        createdAt: Date.now(),
        uploadedBy,
      };

      await persist([newItem, ...photos]);

      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsDataURL(file);
  };

  const canDelete = (p: PhotoItem) => {
    if (isAdmin) return true;
    return p.uploadedBy === uploadedBy;
  };

  const deletePhoto = async (p: PhotoItem) => {
    if (!canDelete(p)) {
      Platform.OS === "web"
        ? window.alert("You can only delete photos you uploaded.")
        : Alert.alert("Not allowed");
      return;
    }

    if (Platform.OS === "web") {
      const ok = window.confirm("Delete photo?");
      if (!ok) return;
      await persist(photos.filter((x) => x.id !== p.id));
      return;
    }

    Alert.alert("Delete photo?", "", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () =>
          await persist(photos.filter((x) => x.id !== p.id)),
      },
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
            fileInputRef.current = el; // ✅ return void (fixes TS error)
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
              <Pressable
                onPress={() => openLightbox(img)}
                style={styles.photoFrame}
              >
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

      {/* ✅ Lightbox Modal (tap/click image to enlarge) */}
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

const CARD_WIDTH = 260; // controls how many fit per row

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },

  button: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },

  // ✅ GRID: left aligned, wraps into rows
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

  // photo frame stays consistent; image shows entire photo
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

  // ✅ LIGHTBOX
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

  lightboxTitle: {
    fontSize: 14,
    opacity: 0.9,
  },

  closeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },

  closeText: {
    fontSize: 16,
    opacity: 0.9,
  },

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

  lightboxHint: {
    fontSize: 12,
    opacity: 0.7,
  },
});
