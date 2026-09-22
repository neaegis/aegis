import { useEffect, useState } from "react";
import { getAuthSession } from "@/shared/api/auth-session";
import { aegisDb, type LocalCollectionRecord } from "@/shared/storage/aegisDb";
import { registerUserScopedRehydrate } from "@/shared/utils/userScope";
import { GUEST_USER } from "@/features/auth/store/authStore";
import type { LibraryItemViewModel } from "../types";

export type EntityType = "album" | "artist" | "playlist";

function currentUserId(): string {
  return getAuthSession()?.user?.id ?? GUEST_USER.id;
}

function toRefType(type: EntityType): "albums" | "artists" | "playlists" {
  return `${type}s` as "albums" | "artists" | "playlists";
}

function toViewModel(
  entry: LocalCollectionRecord,
  type: EntityType,
): LibraryItemViewModel {
  const subtitle =
    entry.payload.subtitle ??
    (type === "playlist"
      ? entry.payload.trackCount
        ? `${entry.payload.trackCount} tracks`
        : "Playlist"
      : type === "artist"
        ? "Artist"
        : "Album");
  return {
    id: entry.refId,
    title: entry.payload.title,
    subtitle,
    imageUrl: entry.payload.coverUrl ?? "",
    kind: type,
    href:
      type === "artist"
        ? `/artist?id=${encodeURIComponent(entry.refId)}`
        : type === "playlist"
          ? `/collection?type=playlist&id=${encodeURIComponent(entry.refId)}`
          : `/collection?type=album&id=${encodeURIComponent(entry.refId)}`,
    addedAt: new Date(entry.savedAt).toISOString(),
    trackCount: entry.payload.trackCount,
    isOwned: false,
  };
}

registerUserScopedRehydrate(() => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("library:changed"));
  }
});

export function useExternalItems(type: EntityType) {
  const [data, setData] = useState<LibraryItemViewModel[]>([]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const entries = await aegisDb.listCollections(currentUserId(), toRefType(type));
        if (!active) return;
        setData(entries.map((entry) => toViewModel(entry, type)));
      } catch {
        if (active) setData([]);
      }
    };
    void load();
    const refresh = () => void load();
    window.addEventListener("library:changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("library:changed", refresh);
    };
  }, [type]);
  return { data };
}