import { useCallback, useState } from "react";
import { ApiError } from "@/shared/api";
import { getAuthSession } from "@/shared/api/auth-session";
import {
  aegisDb,
  type LocalPlaylistRecord,
  type StoredTrackSnapshot,
} from "@/shared/storage/aegisDb";
import { GUEST_USER } from "@/features/auth/store/authStore";
import type { Track } from "@/shared/types";
import { notifyLibraryChanged, evictPlaylistFromCache } from "./usePlaylists";
import { applyOptimisticLike, applyOptimisticUnlike } from "./useLikedTracks";
import type { EntityType } from "./useExternalItems";
import type { LibraryItemDetail } from "../store/modalStore";

type Options = {
  onSuccess?: (...args: any[]) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
};

export type TrackLikeInput =
  | string
  | {
      trackId?: string;
      id?: string;
      title?: string;
      artists?: string;
      artistId?: string;
      coverUrl?: string;
      durationMs?: number;
      playCount?: number;
      artistList?: Track["artistList"];
      album?: Track["album"];
      explicit?: boolean;
    };

function currentUserId(): string {
  return getAuthSession()?.user?.id ?? GUEST_USER.id;
}

function trackIdOf(input: TrackLikeInput): string {
  if (typeof input === "string") return input;
  return input.trackId ?? input.id ?? "";
}

function buildSnapshot(input: TrackLikeInput): StoredTrackSnapshot {
  const o = typeof input === "string" ? {} : input;
  return {
    id: trackIdOf(input),
    title: o.title ?? "",
    artists: o.artists ?? "",
    artistId: o.artistId,
    coverUrl: o.coverUrl ?? "",
    durationMs: o.durationMs ?? 0,
    playCount: o.playCount ?? 0,
    artistList: o.artistList,
    album: o.album,
    explicit: o.explicit,
  };
}

function newId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${suffix}`;
}

function toRefType(type: EntityType): "albums" | "artists" | "playlists" {
  return `${type}s` as "albums" | "artists" | "playlists";
}

function assertPlaylist(
  record: LocalPlaylistRecord | null,
): asserts record is LocalPlaylistRecord {
  if (!record) {
    throw new ApiError(404, "Playlist not found.", "PLAYLIST_NOT_FOUND");
  }
}

// ---- Low-level local operations ---------------------------------------------

export async function createPlaylistLocal(title: string, description?: string) {
  const userId = currentUserId();
  const now = Date.now();
  const playlistId = newId("pl");
  await aegisDb.putPlaylist({
    id: `pl:${userId}:${playlistId}`,
    userId,
    playlistId,
    title,
    description,
    items: [],
    createdAt: now,
    updatedAt: now,
    revision: 0,
  });
  return { id: playlistId, title, description };
}

export async function addPlaylistTrackLocal(
  playlistId: string,
  track: TrackLikeInput,
) {
  const userId = currentUserId();
  const record = await aegisDb.getPlaylist(userId, playlistId);
  assertPlaylist(record);
  const trackId = trackIdOf(track);
  if (record.items.some((i) => i.track.id === trackId)) {
    throw new ApiError(409, "Track is already in the playlist.", "TRACK_ALREADY_IN_PLAYLIST");
  }
  record.items.push({
    itemId: newId("item"),
    track: buildSnapshot(track),
  });
  record.updatedAt = Date.now();
  record.revision += 1;
  await aegisDb.putPlaylist(record);
  return record;
}

export async function removePlaylistItemLocal(playlistId: string, itemId: string) {
  const userId = currentUserId();
  const record = await aegisDb.getPlaylist(userId, playlistId);
  assertPlaylist(record);
  record.items = record.items.filter((i) => i.itemId !== itemId);
  record.updatedAt = Date.now();
  record.revision += 1;
  await aegisDb.putPlaylist(record);
  return record;
}

export async function movePlaylistItemLocal(input: {
  playlistId: string;
  itemId: string;
  beforeItemId: string | null;
  revision: number;
}) {
  const { playlistId, itemId, beforeItemId, revision } = input;
  const userId = currentUserId();
  const record = await aegisDb.getPlaylist(userId, playlistId);
  assertPlaylist(record);
  if (revision !== record.revision) {
    throw new ApiError(409, "Playlist was modified.", "REVISION_CONFLICT");
  }
  const items = [...record.items];
  const idx = items.findIndex((i) => i.itemId === itemId);
  const moved = idx === -1 ? undefined : items[idx];
  if (idx === -1 || !moved) {
    throw new ApiError(404, "Track not found.", "ITEM_NOT_FOUND");
  }
  items.splice(idx, 1);
  if (beforeItemId) {
    const targetIdx = items.findIndex((i) => i.itemId === beforeItemId);
    if (targetIdx === -1) {
      throw new ApiError(404, "Before track not found.", "ITEM_NOT_FOUND");
    }
    items.splice(targetIdx, 0, moved);
  } else {
    items.push(moved);
  }
  record.items = items;
  record.updatedAt = Date.now();
  record.revision += 1;
  await aegisDb.putPlaylist(record);
  return record;
}

export async function updatePlaylistLocal(
  playlistId: string,
  patch: { title?: string; description?: string },
) {
  const userId = currentUserId();
  const record = await aegisDb.getPlaylist(userId, playlistId);
  assertPlaylist(record);
  if (patch.title !== undefined) record.title = patch.title;
  if (patch.description !== undefined) record.description = patch.description;
  record.updatedAt = Date.now();
  await aegisDb.putPlaylist(record);
  return record;
}

export async function deletePlaylistLocal(playlistId: string): Promise<void> {
  const userId = currentUserId();
  await aegisDb.deletePlaylist(userId, playlistId);
}

export async function saveCollectionLocal(
  type: EntityType,
  refId: string,
  item?: LibraryItemDetail,
): Promise<void> {
  const userId = currentUserId();
  await aegisDb.saveCollection(userId, toRefType(type), refId, {
    title: item?.title ?? refId,
    coverUrl: item?.coverUrl,
    subtitle: item?.subtitle,
    trackCount: item?.totalTracks,
  });
}

export async function removeCollectionLocal(input: {
  type: EntityType;
  id: string;
  isOwned?: boolean;
}): Promise<void> {
  const { type, id, isOwned } = input;
  const userId = currentUserId();
  if (type === "playlist") {
    evictPlaylistFromCache(id);
    await aegisDb.removeCollection(userId, "playlists", id);
    if (isOwned !== false) {
      await aegisDb.deletePlaylist(userId, id);
    }
    return;
  }
  await aegisDb.removeCollection(userId, toRefType(type), id);
}

export async function likeTrackLocal(input: TrackLikeInput): Promise<void> {
  const userId = currentUserId();
  await aegisDb.putLike(userId, buildSnapshot(input));
}

export async function unlikeTrackLocal(trackId: string): Promise<void> {
  const userId = currentUserId();
  await aegisDb.deleteLike(userId, trackId);
}

// ---- Mutation hooks ----------------------------------------------------------

function useMutation<T, R = unknown>(action: (input: T) => Promise<R>) {
  const [isPending, setIsPending] = useState(false);
  const mutateAsync = useCallback(
    async (input: T): Promise<R> => {
      setIsPending(true);
      try {
        const result = await action(input);
        notifyLibraryChanged();
        return result;
      } finally {
        setIsPending(false);
      }
    },
    [action]
  );
  const mutate = useCallback(
    (input: T, options?: Options) => {
      void mutateAsync(input)
        .then((value) => options?.onSuccess?.(value))
        .catch((error) => options?.onError?.(error))
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync]
  );
  return { mutate, mutateAsync, isPending };
}

export function useAddPlaylistTracks() {
  return useMutation(
    ({ playlistId, track }: { playlistId: string; track: TrackLikeInput }) =>
      addPlaylistTrackLocal(playlistId, track)
  );
}

export function useRemovePlaylistTracks() {
  return useMutation(({ playlistId, itemId }: { playlistId: string; itemId: string }) =>
    removePlaylistItemLocal(playlistId, itemId)
  );
}

export function useReorderPlaylistTracks() {
  return useMutation(
    ({
      playlistId,
      itemId,
      beforeItemId,
      revision,
    }: {
      playlistId: string;
      itemId: string;
      beforeItemId: string | null;
      revision: number;
    }) => movePlaylistItemLocal({ playlistId, itemId, beforeItemId, revision })
  );
}

export function useCreatePlaylist() {
  return useMutation(({ title, description }: { title: string; description?: string }) =>
    createPlaylistLocal(title, description)
  );
}

export function useDeletePlaylist() {
  return useMutation(async ({ playlistId }: { playlistId: string }) => {
    evictPlaylistFromCache(playlistId);
    await deletePlaylistLocal(playlistId);
  });
}

export function useSaveExternalItem() {
  return useMutation(
    ({
      type,
      id,
      item,
    }: {
      type: EntityType;
      id: string;
      item?: LibraryItemDetail;
    }) => saveCollectionLocal(type, id, item)
  );
}

export function useRemoveExternalItem() {
  return useMutation(
    ({ type, id, isOwned }: { type: EntityType; id: string; isOwned?: boolean }) =>
      removeCollectionLocal({ type, id, isOwned })
  );
}

export function useLikeTrack() {
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(async (input: TrackLikeInput) => {
    const trackId = trackIdOf(input);
    setIsPending(true);
    const rollback = applyOptimisticLike(trackId);
    try {
      await likeTrackLocal(input);
      notifyLibraryChanged();
    } catch (err) {
      rollback();
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const mutate = useCallback(
    (input: TrackLikeInput, options?: Options) => {
      void mutateAsync(input)
        .then((value) => options?.onSuccess?.(value))
        .catch((error) => options?.onError?.(error))
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync]
  );

  return { mutate, mutateAsync, isPending };
}

export function useUnlikeTrack() {
  const [isPending, setIsPending] = useState(false);

  const mutateAsync = useCallback(async (input: TrackLikeInput) => {
    const trackId = trackIdOf(input);
    setIsPending(true);
    const rollback = applyOptimisticUnlike(trackId);
    try {
      await unlikeTrackLocal(trackId);
      notifyLibraryChanged();
    } catch (err) {
      rollback();
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const mutate = useCallback(
    (input: TrackLikeInput, options?: Options) => {
      void mutateAsync(input)
        .then((value) => options?.onSuccess?.(value))
        .catch((error) => options?.onError?.(error))
        .finally(() => options?.onSettled?.());
    },
    [mutateAsync]
  );

  return { mutate, mutateAsync, isPending };
}