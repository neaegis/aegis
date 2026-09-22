import type { Track } from "@/shared/types";
import type { LyricsCandidate, LyricsSyncLevel } from "@/shared/contracts/lyrics";
import type { LyricsProviderOption } from "@/features/lyrics/store/lyricsStore";

export interface CachedTrackRecord {
  id: string;
  title: string;
  artists: string;
  albumTitle?: string;
  albumId?: string;
  coverUrl?: string;
  durationMs: number;
  savedAt: number;
}

export interface CachedAudioRecord {
  trackId: string;
  blob: Blob;
  mimeType: string;
  byteSize: number;
  savedAt: number;
  lastPlayedAt?: number;
}

export interface CachedLyricsRecord {
  trackId: string;
  syncLevel: LyricsSyncLevel;
  quality: number;
  activeProvider: string;
  availableProviders: LyricsProviderOption[];
  rawLyrics: string;
  rawFormat: string;
  candidate: LyricsCandidate;
  lastCheckedAt: number;
  updatedAt: number;
  userLocked?: boolean;
}

export interface CachedArtistRecord {
  id: string;
  data: any;
  savedAt: number;
  lastCheckedAt: number;
}

export type StoredTrackSnapshot = Pick<
  Track,
  "id" | "title" | "artists" | "coverUrl" | "durationMs" | "playCount"
> & {
  artistId?: string;
  artistList?: Track["artistList"];
  album?: Track["album"];
  explicit?: boolean;
};

export interface LocalUserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  avatarUrl?: string | null;
  bio?: string | null;
  isPublic?: boolean;
  createdAt: number;
}

export interface LocalLikeRecord {
  id: string;
  userId: string;
  track: StoredTrackSnapshot;
  likedAt: number;
}

export interface LocalPlaylistItemRecord {
  itemId: string;
  track: StoredTrackSnapshot;
}

export interface LocalPlaylistRecord {
  id: string;
  userId: string;
  playlistId: string;
  title: string;
  description?: string;
  items: LocalPlaylistItemRecord[];
  createdAt: number;
  updatedAt: number;
  revision: number;
}

export interface LocalCollectionRecord {
  id: string;
  userId: string;
  type: "albums" | "artists" | "playlists";
  refId: string;
  payload: {
    title: string;
    coverUrl?: string;
    subtitle?: string;
    trackCount?: number;
  };
  savedAt: number;
}

const DB_NAME = "liner_db_v1";
const DB_VERSION = 4;

type StoreName =
  | "tracks"
  | "audio"
  | "lyrics"
  | "artists"
  | "users"
  | "likes"
  | "playlists"
  | "collections";

function likeKey(userId: string, trackId: string): string {
  return `like:${userId}:${trackId}`;
}

function playlistKey(userId: string, playlistId: string): string {
  return `pl:${userId}:${playlistId}`;
}

function collectionKey(
  userId: string,
  type: "albums" | "artists" | "playlists",
  refId: string,
): string {
  return `col:${userId}:${type}:${refId}`;
}

class AegisDb {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private isSupported = typeof indexedDB !== "undefined";

  private memTracks = new Map<string, CachedTrackRecord>();
  private memAudio = new Map<string, CachedAudioRecord>();
  private memLyrics = new Map<string, CachedLyricsRecord>();
  private memArtists = new Map<string, CachedArtistRecord>();
  private memUsers = new Map<string, LocalUserRecord>();
  private memLikes = new Map<string, LocalLikeRecord>();
  private memPlaylists = new Map<string, LocalPlaylistRecord>();
  private memCollections = new Map<string, LocalCollectionRecord>();

  private handleDbError(err: unknown) {
    this.dbPromise = null;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.isSupported) {
      return Promise.reject(new Error("IndexedDB is not available"));
    }

    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        this.dbPromise = null;
        reject(err);
        return;
      }

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains("tracks")) {
          const trackStore = db.createObjectStore("tracks", { keyPath: "id" });
          trackStore.createIndex("savedAt", "savedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("audio")) {
          const audioStore = db.createObjectStore("audio", { keyPath: "trackId" });
          audioStore.createIndex("savedAt", "savedAt", { unique: false });
          audioStore.createIndex("byteSize", "byteSize", { unique: false });
          audioStore.createIndex("lastPlayedAt", "lastPlayedAt", { unique: false });
        } else {
          const audioStore = request.transaction?.objectStore("audio");
          if (audioStore && !audioStore.indexNames.contains("lastPlayedAt")) {
            audioStore.createIndex("lastPlayedAt", "lastPlayedAt", { unique: false });
          }
        }

        if (!db.objectStoreNames.contains("lyrics")) {
          const lyricsStore = db.createObjectStore("lyrics", { keyPath: "trackId" });
          lyricsStore.createIndex("lastCheckedAt", "lastCheckedAt", { unique: false });
          lyricsStore.createIndex("syncLevel", "syncLevel", { unique: false });
        }

        if (!db.objectStoreNames.contains("artists")) {
          const artistStore = db.createObjectStore("artists", { keyPath: "id" });
          artistStore.createIndex("lastCheckedAt", "lastCheckedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("users")) {
          const userStore = db.createObjectStore("users", { keyPath: "id" });
          userStore.createIndex("username", "username", { unique: true });
        }

        if (!db.objectStoreNames.contains("likes")) {
          const likeStore = db.createObjectStore("likes", { keyPath: "id" });
          likeStore.createIndex("userId", "userId", { unique: false });
          likeStore.createIndex("likedAt", "likedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("playlists")) {
          const playlistStore = db.createObjectStore("playlists", {
            keyPath: "id",
          });
          playlistStore.createIndex("userId", "userId", { unique: false });
          playlistStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }

        if (!db.objectStoreNames.contains("collections")) {
          const collectionStore = db.createObjectStore("collections", {
            keyPath: "id",
          });
          collectionStore.createIndex("userId", "userId", { unique: false });
          collectionStore.createIndex("savedAt", "savedAt", { unique: false });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          this.dbPromise = null;
        };
        db.onversionchange = () => {
          try {
            db.close();
          } catch {}
          this.dbPromise = null;
        };
        db.onerror = () => {
          this.dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };

      request.onblocked = () => {
        this.dbPromise = null;
      };
    });

    return this.dbPromise;
  }

  // executes indexeddb transaction with one auto-reconnect retry and zero unhandled rejections
  private async runTransaction<T>(
    storeName: StoreName,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T | null> {
    if (!this.isSupported) return null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const db = await this.open();
        return await new Promise<T>((resolve, reject) => {
          try {
            const tx = db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error("tx aborted"));
            operation(store).then(resolve, reject);
          } catch (err) {
            reject(err);
          }
        });
      } catch (err) {
        this.handleDbError(err);
        if (attempt === 0) {
          // retry once on fresh connection
          continue;
        }
      }
    }
    return null;
  }

  async getTrack(id: string): Promise<CachedTrackRecord | null> {
    const mem = this.memTracks.get(id);
    if (mem) return mem;

    const result = await this.runTransaction("tracks", "readonly", (store) => {
      return new Promise<CachedTrackRecord | null>((resolve) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memTracks.set(id, result);
      return result;
    }
    return this.memTracks.get(id) || null;
  }

  async putTrack(track: Track): Promise<void> {
    const record: CachedTrackRecord = {
      id: track.id,
      title: track.title,
      artists: track.artists,
      albumTitle: track.album?.title,
      albumId: track.album?.id,
      coverUrl: track.coverUrl,
      durationMs: track.durationMs,
      savedAt: Date.now(),
    };
    this.memTracks.set(track.id, record);

    await this.runTransaction("tracks", "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async getTotalTrackBytes(): Promise<number> {
    const result = await this.runTransaction("tracks", "readonly", (store) => {
      return new Promise<number>((resolve) => {
        let total = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as CachedTrackRecord;
            total += JSON.stringify(val || {}).length * 2;
            cursor.continue();
          } else {
            resolve(total);
          }
        };
        req.onerror = () => resolve(0);
      });
    });

    if (result !== null && result !== undefined) {
      return result;
    }

    let total = 0;
    for (const item of this.memTracks.values()) {
      total += JSON.stringify(item || {}).length * 2;
    }
    return total;
  }

  async getAudio(trackId: string): Promise<CachedAudioRecord | null> {
    const mem = this.memAudio.get(trackId);
    if (mem) return mem;

    const result = await this.runTransaction("audio", "readonly", (store) => {
      return new Promise<CachedAudioRecord | null>((resolve) => {
        const req = store.get(trackId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memAudio.set(trackId, result);
      return result;
    }
    return this.memAudio.get(trackId) || null;
  }

  async putAudio(trackId: string, blob: Blob, mimeType: string, lastPlayedAt?: number): Promise<void> {
    const existing = this.memAudio.get(trackId);
    const now = Date.now();
    const record: CachedAudioRecord = {
      trackId,
      blob,
      mimeType,
      byteSize: blob.size,
      savedAt: existing?.savedAt ?? now,
      lastPlayedAt: lastPlayedAt ?? now,
    };
    this.memAudio.set(trackId, record);

    await this.runTransaction("audio", "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async touchAudio(trackId: string): Promise<void> {
    const record = await this.getAudio(trackId);
    if (!record) return;
    record.lastPlayedAt = Date.now();
    this.memAudio.set(trackId, record);

    await this.runTransaction("audio", "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async getOldestAudioRecords(): Promise<CachedAudioRecord[]> {
    const result = await this.runTransaction("audio", "readonly", (store) => {
      return new Promise<CachedAudioRecord[]>((resolve) => {
        const records: CachedAudioRecord[] = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            records.push(cursor.value as CachedAudioRecord);
            cursor.continue();
          } else {
            records.sort((a, b) => (a.lastPlayedAt ?? a.savedAt) - (b.lastPlayedAt ?? b.savedAt));
            resolve(records);
          }
        };
        req.onerror = () => resolve([]);
      });
    });

    if (result && result.length > 0) {
      return result;
    }

    const memList = Array.from(this.memAudio.values());
    memList.sort((a, b) => (a.lastPlayedAt ?? a.savedAt) - (b.lastPlayedAt ?? b.savedAt));
    return memList;
  }

  async hasAudio(trackId: string): Promise<boolean> {
    if (this.memAudio.has(trackId)) return true;

    const result = await this.runTransaction("audio", "readonly", (store) => {
      return new Promise<boolean>((resolve) => {
        const req = store.count(IDBKeyRange.only(trackId));
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => resolve(false);
      });
    });

    return result ?? this.memAudio.has(trackId);
  }

  async deleteAudio(trackId: string): Promise<void> {
    this.memAudio.delete(trackId);

    await this.runTransaction("audio", "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        const req = store.delete(trackId);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async getTotalAudioBytes(): Promise<number> {
    const result = await this.runTransaction("audio", "readonly", (store) => {
      return new Promise<number>((resolve) => {
        let total = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as CachedAudioRecord;
            total += val.byteSize || val.blob?.size || 0;
            cursor.continue();
          } else {
            resolve(total);
          }
        };
        req.onerror = () => resolve(0);
      });
    });

    if (result !== null && result !== undefined) {
      return result;
    }

    let total = 0;
    for (const item of this.memAudio.values()) {
      total += item.byteSize || 0;
    }
    return total;
  }

  async getLyrics(trackId: string): Promise<CachedLyricsRecord | null> {
    const mem = this.memLyrics.get(trackId);
    if (mem) return mem;

    const result = await this.runTransaction("lyrics", "readonly", (store) => {
      return new Promise<CachedLyricsRecord | null>((resolve) => {
        const req = store.get(trackId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memLyrics.set(trackId, result);
      return result;
    }
    return this.memLyrics.get(trackId) || null;
  }

  async putLyrics(record: CachedLyricsRecord): Promise<void> {
    if (record.syncLevel !== "word_level" && record.syncLevel !== "syllable_level") {
      return;
    }
    this.memLyrics.set(record.trackId, record);

    await this.runTransaction("lyrics", "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async updateLyricsChecked(trackId: string): Promise<void> {
    const existing = await this.getLyrics(trackId);
    if (!existing) return;
    existing.lastCheckedAt = Date.now();
    await this.putLyrics(existing);
  }

  async getTotalLyricsBytes(): Promise<number> {
    const result = await this.runTransaction("lyrics", "readonly", (store) => {
      return new Promise<number>((resolve) => {
        let total = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as CachedLyricsRecord;
            total += (val.rawLyrics?.length || 0) * 2;
            cursor.continue();
          } else {
            resolve(total);
          }
        };
        req.onerror = () => resolve(0);
      });
    });

    if (result !== null && result !== undefined) {
      return result;
    }

    let total = 0;
    for (const item of this.memLyrics.values()) {
      total += (item.rawLyrics?.length || 0) * 2;
    }
    return total;
  }

  async getArtist(id: string): Promise<CachedArtistRecord | null> {
    const mem = this.memArtists.get(id);
    if (mem) return mem;

    const result = await this.runTransaction("artists", "readonly", (store) => {
      return new Promise<CachedArtistRecord | null>((resolve) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });

    if (result) {
      this.memArtists.set(id, result);
      return result;
    }
    return this.memArtists.get(id) || null;
  }

  async putArtist(record: CachedArtistRecord): Promise<void> {
    this.memArtists.set(record.id, record);

    await this.runTransaction("artists", "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  async updateArtistChecked(id: string): Promise<void> {
    const existing = await this.getArtist(id);
    if (!existing) return;
    existing.lastCheckedAt = Date.now();
    await this.putArtist(existing);
  }

  async getTotalArtistBytes(): Promise<number> {
    const result = await this.runTransaction("artists", "readonly", (store) => {
      return new Promise<number>((resolve) => {
        let total = 0;
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const val = cursor.value as CachedArtistRecord;
            total += JSON.stringify(val.data || {}).length * 2;
            cursor.continue();
          } else {
            resolve(total);
          }
        };
        req.onerror = () => resolve(0);
      });
    });

    if (result !== null && result !== undefined) {
      return result;
    }

    let total = 0;
    for (const item of this.memArtists.values()) {
      total += JSON.stringify(item.data || {}).length * 2;
    }
    return total;
  }

  private async readRecord<T>(storeName: StoreName, key: string): Promise<T | null> {
    const result = await this.runTransaction(storeName, "readonly", (store) => {
      return new Promise<T | null>((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    });
    return result ?? null;
  }

  private async writeRecord(storeName: StoreName, record: unknown): Promise<void> {
    await this.runTransaction(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve, reject) => {
        const req = store.put(record);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });
  }

  private async deleteRecord(storeName: StoreName, key: string): Promise<void> {
    await this.runTransaction(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  private async readAllByIndex<T>(
    storeName: StoreName,
    indexName: string,
    value: string,
  ): Promise<T[]> {
    const result = await this.runTransaction(storeName, "readonly", (store) => {
      return new Promise<T[]>((resolve) => {
        const records: T[] = [];
        const req = store.index(indexName).openCursor(IDBKeyRange.only(value));
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            records.push(cursor.value as T);
            cursor.continue();
          } else {
            resolve(records);
          }
        };
        req.onerror = () => resolve([]);
      });
    });
    return result && result.length > 0 ? result : [];
  }

  // ---- Local users ---------------------------------------------------------

  async getUser(id: string): Promise<LocalUserRecord | null> {
    const mem = this.memUsers.get(id);
    if (mem) return mem;
    const result = await this.readRecord<LocalUserRecord>("users", id);
    if (result) this.memUsers.set(id, result);
    return result ?? this.memUsers.get(id) ?? null;
  }

  async getUserByUsername(username: string): Promise<LocalUserRecord | null> {
    for (const record of this.memUsers.values()) {
      if (record.username === username) return record;
    }
    const result = await this.readAllByIndex<LocalUserRecord>(
      "users",
      "username",
      username,
    );
    if (result.length > 0) {
      this.memUsers.set(result[0].id, result[0]);
      return result[0];
    }
    return null;
  }

  async putUser(record: LocalUserRecord): Promise<void> {
    this.memUsers.set(record.id, record);
    await this.writeRecord("users", record);
  }

  async updateUser(
    id: string,
    patch: Partial<Omit<LocalUserRecord, "id" | "passwordHash">>,
  ): Promise<LocalUserRecord | null> {
    const existing = (await this.getUser(id)) ?? null;
    if (!existing) return null;
    const updated: LocalUserRecord = {
      ...existing,
      ...patch,
      passwordHash: existing.passwordHash,
    };
    this.memUsers.set(id, updated);
    await this.writeRecord("users", updated);
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    this.memUsers.delete(id);
    await this.deleteRecord("users", id);
  }

  // ---- Local library: likes ------------------------------------------------

  async putLike(userId: string, track: StoredTrackSnapshot): Promise<void> {
    const now = Date.now();
    const record: LocalLikeRecord = {
      id: likeKey(userId, track.id),
      userId,
      track,
      likedAt: now,
    };
    this.memLikes.set(record.id, record);
    await this.writeRecord("likes", record);
  }

  async deleteLike(userId: string, trackId: string): Promise<void> {
    const key = likeKey(userId, trackId);
    this.memLikes.delete(key);
    await this.deleteRecord("likes", key);
  }

  async listLikes(userId: string): Promise<LocalLikeRecord[]> {
    const mem = Array.from(this.memLikes.values()).filter((r) => r.userId === userId);
    if (mem.length > 0) {
      return mem.sort((a, b) => b.likedAt - a.likedAt);
    }
    const result = await this.readAllByIndex<LocalLikeRecord>("likes", "userId", userId);
    result.sort((a, b) => b.likedAt - a.likedAt);
    return result;
  }

  // ---- Local library: playlists --------------------------------------------

  async putPlaylist(record: LocalPlaylistRecord): Promise<void> {
    this.memPlaylists.set(record.id, record);
    await this.writeRecord("playlists", record);
  }

  async getPlaylist(
    userId: string,
    playlistId: string,
  ): Promise<LocalPlaylistRecord | null> {
    const key = playlistKey(userId, playlistId);
    const mem = this.memPlaylists.get(key);
    if (mem) return mem;
    const result = await this.readRecord<LocalPlaylistRecord>("playlists", key);
    if (result) this.memPlaylists.set(key, result);
    return result ?? this.memPlaylists.get(key) ?? null;
  }

  async listPlaylists(userId: string): Promise<LocalPlaylistRecord[]> {
    const mem = Array.from(this.memPlaylists.values()).filter(
      (r) => r.userId === userId,
    );
    if (mem.length > 0) {
      return mem.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    const result = await this.readAllByIndex<LocalPlaylistRecord>(
      "playlists",
      "userId",
      userId,
    );
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  async deletePlaylist(userId: string, playlistId: string): Promise<void> {
    const key = playlistKey(userId, playlistId);
    this.memPlaylists.delete(key);
    await this.deleteRecord("playlists", key);
  }

  // ---- Local library: saved collections ------------------------------------

  async saveCollection(
    userId: string,
    refType: "albums" | "artists" | "playlists",
    refId: string,
    payload: LocalCollectionRecord["payload"],
  ): Promise<void> {
    const now = Date.now();
    const record: LocalCollectionRecord = {
      id: collectionKey(userId, refType, refId),
      userId,
      type: refType,
      refId,
      payload,
      savedAt: now,
    };
    this.memCollections.set(record.id, record);
    await this.writeRecord("collections", record);
  }

  async removeCollection(
    userId: string,
    refType: "albums" | "artists" | "playlists",
    refId: string,
  ): Promise<void> {
    const key = collectionKey(userId, refType, refId);
    this.memCollections.delete(key);
    await this.deleteRecord("collections", key);
  }

  async listCollections(
    userId: string,
    refType: "albums" | "artists" | "playlists",
  ): Promise<LocalCollectionRecord[]> {
    const mem = Array.from(this.memCollections.values()).filter(
      (r) => r.userId === userId && r.type === refType,
    );
    if (mem.length > 0) {
      return mem.sort((a, b) => b.savedAt - a.savedAt);
    }
    const result = await this.readAllByIndex<LocalCollectionRecord>(
      "collections",
      "userId",
      userId,
    );
    return result
      .filter((r) => r.type === refType)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // ---- Test/session helpers -------------------------------------------------

  async deleteAllForUser(userId: string): Promise<void> {
    for (const [key, record] of this.memLikes) {
      if (record.userId === userId) this.memLikes.delete(key);
    }
    const likes = await this.readAllByIndex<LocalLikeRecord>("likes", "userId", userId);
    for (const like of likes) await this.deleteRecord("likes", like.id);

    for (const [key, record] of this.memPlaylists) {
      if (record.userId === userId) this.memPlaylists.delete(key);
    }
    const playlists = await this.readAllByIndex<LocalPlaylistRecord>(
      "playlists",
      "userId",
      userId,
    );
    for (const playlist of playlists) await this.deleteRecord("playlists", playlist.id);

    for (const [key, record] of this.memCollections) {
      if (record.userId === userId) this.memCollections.delete(key);
    }
    const collections = await this.readAllByIndex<LocalCollectionRecord>(
      "collections",
      "userId",
      userId,
    );
    for (const item of collections) await this.deleteRecord("collections", item.id);
  }

  async clearStore(storeName: StoreName): Promise<void> {
    if (storeName === "tracks") this.memTracks.clear();
    if (storeName === "audio") this.memAudio.clear();
    if (storeName === "lyrics") this.memLyrics.clear();
    if (storeName === "artists") this.memArtists.clear();
    if (storeName === "users") this.memUsers.clear();
    if (storeName === "likes") this.memLikes.clear();
    if (storeName === "playlists") this.memPlaylists.clear();
    if (storeName === "collections") this.memCollections.clear();

    await this.runTransaction(storeName, "readwrite", (store) => {
      return new Promise<void>((resolve) => {
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    });
  }

  async clearAll(): Promise<void> {
    await this.clearStore("audio");
    await this.clearStore("tracks");
    await this.clearStore("lyrics");
    await this.clearStore("artists");
  }
}

export const aegisDb = new AegisDb();
