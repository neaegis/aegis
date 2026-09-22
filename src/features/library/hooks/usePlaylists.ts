import { useEffect, useState, useSyncExternalStore } from "react";
import { getAuthSession } from "@/shared/api/auth-session";
import { aegisDb, type LocalPlaylistRecord } from "@/shared/storage/aegisDb";
import { registerUserScopedRehydrate } from "@/shared/utils/userScope";
import { GUEST_USER } from "@/features/auth/store/authStore";
import type { Track } from "@/shared/types";

export interface LibraryPlaylistSummary {
  id: string;
  title: string;
  description?: string;
  trackCount: number;
  coverUrl: string;
  coverUrls: string[];
  updatedAt: string;
  createdAt: string;
  revision: number;
}

export interface LibraryPlaylistDetail {
  id: string;
  title: string;
  description?: string;
  trackCount: number;
  coverUrl: string;
  coverUrls: string[];
  revision: number;
  tracks: Track[];
}

type PlaylistList = { playlists: LibraryPlaylistSummary[]; total: number };

function currentUserId(): string {
  return getAuthSession()?.user?.id ?? GUEST_USER.id;
}

function extractCovers(items: LocalPlaylistRecord["items"]): string[] {
  return items
    .map((i) => i.track.coverUrl ?? "")
    .filter(Boolean)
    .filter((url, idx, arr) => arr.indexOf(url) === idx)
    .slice(0, 4);
}

function toSummary(record: LocalPlaylistRecord): LibraryPlaylistSummary {
  const coverUrls = extractCovers(record.items);
  return {
    id: record.playlistId,
    title: record.title,
    description: record.description,
    trackCount: record.items.length,
    coverUrl: coverUrls[0] ?? "",
    coverUrls,
    updatedAt: new Date(record.updatedAt).toISOString(),
    createdAt: new Date(record.createdAt).toISOString(),
    revision: record.revision,
  };
}

const EMPTY: PlaylistList = { playlists: [], total: 0 };
let cache = EMPTY;
let loaded = false;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();
let view = { data: cache, error: undefined as unknown, isLoading: true };
let generation = 0;

export function notifyLibraryChanged() {
  window.dispatchEvent(new Event("library:changed"));
}

// optimistically drop playlist from store so ui reacts instantly
export function evictPlaylistFromCache(id: string) {
  cache = {
    playlists: cache.playlists.filter((p) => p.id !== id),
    total: Math.max(0, cache.total - 1),
  };
  emit();
}

function emit() {
  view = { data: cache, error: undefined, isLoading: false };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return view;
}

const SERVER_SNAPSHOT = { data: EMPTY, error: undefined as unknown, isLoading: true };

function load(force = false): Promise<void> {
  if (request) return request;
  if (loaded && !force) return Promise.resolve();

  if (!loaded) {
    view = { data: cache, error: undefined, isLoading: true };
    emit();
  }

  request = (() => {
    const gen = generation;
    return (async () => {
      const records = await aegisDb.listPlaylists(currentUserId());
      if (gen !== generation) return;
      cache = { playlists: records.map(toSummary), total: records.length };
      loaded = true;
    })()
      .catch(() => {
        if (gen === generation) {
          cache = EMPTY;
          loaded = true;
        }
      })
      .finally(() => {
        request = null;
        if (gen === generation) emit();
      });
  })();
  return request;
}

if (typeof window !== "undefined") {
  const target = window as Window & { __aegisPlaylistsRefresh?: EventListener };
  if (target.__aegisPlaylistsRefresh)
    window.removeEventListener("library:changed", target.__aegisPlaylistsRefresh);
  target.__aegisPlaylistsRefresh = () => {
    // silent background refresh without toggling loading state
    void load(true);
  };
  window.addEventListener("library:changed", target.__aegisPlaylistsRefresh);
}

registerUserScopedRehydrate(() => {
  generation += 1;
  loaded = false;
  cache = EMPTY;
  void load();
});

export function usePlaylistsList() {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    void load();
  }, []);
  return state;
}

export function usePlaylist(id: string | null) {
  const [data, setData] = useState<LibraryPlaylistDetail | null>(null);
  const [error, setError] = useState<unknown>();
  const [isLoading, setIsLoading] = useState(Boolean(id));

  useEffect(() => {
    if (!id) {
      setData(null);
      setIsLoading(false);
      return;
    }
    let active = true;

    const fetchDetail = async (isBackground = false) => {
      if (!isBackground) setIsLoading(true);
      try {
        const record = await aegisDb.getPlaylist(currentUserId(), id);
        if (!active) return;
        if (!record) {
          setData(null);
          return;
        }
        const covers = extractCovers(record.items);
        setData({
          id: record.playlistId,
          title: record.title,
          description: record.description,
          trackCount: record.items.length,
          coverUrl: covers[0] ?? "",
          coverUrls: covers,
          revision: record.revision,
          tracks: record.items.map((i) =>
            ({
              ...i.track,
              playlistItemId: i.itemId,
            } as Track),
          ),
        });
      } catch (err) {
        if (active) setError(err);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void fetchDetail(false);
    const refresh = () => void fetchDetail(true);
    window.addEventListener("library:changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("library:changed", refresh);
    };
  }, [id]);

  return { data, error, isLoading };
}