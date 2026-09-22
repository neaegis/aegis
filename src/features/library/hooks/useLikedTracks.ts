import { useEffect, useSyncExternalStore } from "react";
import { getAuthSession } from "@/shared/api/auth-session";
import { aegisDb, type LocalLikeRecord } from "@/shared/storage/aegisDb";
import { registerUserScopedRehydrate } from "@/shared/utils/userScope";
import { GUEST_USER } from "@/features/auth/store/authStore";
import type { Track } from "@/shared/types";

type LikedData = { tracks: Track[]; total: number };
const EMPTY: LikedData = { tracks: [], total: 0 };
let cache: LikedData = EMPTY;
let loaded = false;
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();
let view = { data: cache, isLoading: true };
let generation = 0;

const optimisticOverrides = new Map<string, boolean>();

function currentUserId(): string {
  return getAuthSession()?.user?.id ?? GUEST_USER.id;
}

function toTrack(record: LocalLikeRecord): Track {
  const s = record.track;
  return {
    id: s.id,
    title: s.title,
    artists: s.artists,
    artistId: s.artistId,
    artistList: s.artistList,
    album: s.album,
    coverUrl: s.coverUrl ?? "",
    durationMs: s.durationMs ?? 0,
    playCount: s.playCount ?? 0,
    explicit: s.explicit,
  } as Track;
}

function buildView(isLoading: boolean): { data: LikedData; isLoading: boolean } {
  if (optimisticOverrides.size === 0) return { data: cache, isLoading };

  let tracks = cache.tracks.filter(
    (t) => optimisticOverrides.get(t.id) !== false,
  );
  for (const [id, liked] of optimisticOverrides) {
    if (liked && !tracks.some((t) => t.id === id)) {
      tracks = [
        { id, title: "", artists: "", coverUrl: "", durationMs: 0, playCount: 0 } as Track,
        ...tracks,
      ];
    }
  }
  return { data: { tracks, total: tracks.length }, isLoading };
}

function emit(isLoading = false) {
  view = buildView(isLoading);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot() {
  return view;
}

const SERVER_SNAPSHOT = { data: EMPTY, isLoading: true };

function load(force = false): Promise<void> {
  if (request) return request;
  if (loaded && !force) return Promise.resolve();

  if (!loaded) emit(true);

  request = (() => {
    const gen = generation;
    return (async () => {
      const records = await aegisDb.listLikes(currentUserId());
      if (gen !== generation) return;
      cache = { tracks: records.map(toTrack), total: records.length };
      loaded = true;
      optimisticOverrides.clear();
    })()
      .catch(() => {
        if (gen === generation) {
          cache = EMPTY;
          loaded = true;
        }
      })
      .finally(() => {
        request = null;
        if (gen === generation) emit(false);
      });
  })();
  return request;
}

export function applyOptimisticLike(trackId: string): () => void {
  const prev = optimisticOverrides.get(trackId);
  optimisticOverrides.set(trackId, true);
  emit(false);
  return () => {
    if (prev === undefined) optimisticOverrides.delete(trackId);
    else optimisticOverrides.set(trackId, prev);
    emit(false);
  };
}

export function applyOptimisticUnlike(trackId: string): () => void {
  const prev = optimisticOverrides.get(trackId);
  optimisticOverrides.set(trackId, false);
  emit(false);
  return () => {
    if (prev === undefined) optimisticOverrides.delete(trackId);
    else optimisticOverrides.set(trackId, prev);
    emit(false);
  };
}

if (typeof window !== "undefined") {
  const target = window as Window & { __aegisLikedRefresh?: EventListener };
  if (target.__aegisLikedRefresh)
    window.removeEventListener("library:changed", target.__aegisLikedRefresh);
  target.__aegisLikedRefresh = () => {
    // silent background refresh without toggling loading state
    void load(true);
  };
  window.addEventListener("library:changed", target.__aegisLikedRefresh);
}

registerUserScopedRehydrate(() => {
  generation += 1;
  loaded = false;
  cache = EMPTY;
  optimisticOverrides.clear();
  void load();
});

export function useLikedTracks(_params?: { limit?: number; offset?: number }) {
  const state = useSyncExternalStore(subscribe, snapshot, () => SERVER_SNAPSHOT);
  useEffect(() => {
    void load();
  }, []);
  return state;
}

export function useLikedTrackCount() {
  const { data, isLoading } = useLikedTracks();
  return { data: data.total, isLoading };
}