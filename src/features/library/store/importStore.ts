import { create } from "zustand";
import { api, type ImportJob, type ImportReview } from "@/shared/api";
import { showToast } from "@/shared/ui";
import { createTranslatorSync, getStoredLocale } from "@/languages";
import { notifyLibraryChanged } from "../hooks/usePlaylists";
import { useModalStore, type TrackDetail } from "./modalStore";
import {
  detectImportSource,
  LocalImportError,
  parsePageForKind,
  type SourceTrackSeed,
} from "../import/parsers";
import { matchSeedsToCatalog } from "../import/matcher";
import {
  resolveSoundCloudPlaylist,
  soundCloudTrackToSeed,
} from "../import/soundcloudClient";

export interface ActiveImportState {
  job: ImportJob | null;
  isPolling: boolean;
  mode: "server" | "local" | null;
  error: string | null;
  pendingTrack: TrackDetail | null;
  reviewItems: ImportReview[] | null;
  approvedTracks: any[] | null;
  startImport: (url: string, pendingTrack?: TrackDetail | null) => Promise<ImportJob>;
  importLocalSeeds: (
    tracks: SourceTrackSeed[],
    opts?: {
      source?: ImportJob["source"];
      sourceUrl?: string;
      title?: string;
      description?: string;
    },
  ) => Promise<ImportJob>;
  listenToWebSocketWorker: (job: ImportJob) => void;
  pollJob: (jobId: string) => Promise<void>;
  cancelPolling: () => void;
  reset: () => void;
}

interface PageFetchBridge {
  fetchPage?: (url: string) => Promise<{
    ok: boolean;
    status: number;
    finalUrl: string;
    text: string;
    sizeBytes: number;
    error?: string;
  }>;
}

let activeWebSocket: WebSocket | null = null;
let activeAbortController: AbortController | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function cleanupActiveConnections() {
  if (activeWebSocket) {
    try {
      activeWebSocket.onopen = null;
      activeWebSocket.onmessage = null;
      activeWebSocket.onerror = null;
      activeWebSocket.onclose = null;
      activeWebSocket.close();
    } catch {}
    activeWebSocket = null;
  }
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

function localErrorMessage(code: string, kind: string): string {
  const translate = createTranslatorSync(getStoredLocale());
  switch (code) {
    case "network":
      return translate("import.local_network_error");
    case "unsupported_source":
      if (kind === "vk") return translate("import.local_source_vk");
      if (kind === "yandex") return translate("import.local_source_yandex");
      return translate("import.local_source_unsupported");
    case "spotify_unavailable":
      return translate("import.local_spotify_unavailable");
    case "no_tracks":
    default:
      return translate("import.local_no_tracks_found");
  }
}

async function fetchImportedPage(url: string): Promise<string> {
  const bridge = (window as unknown as { aegisElectron?: PageFetchBridge }).aegisElectron;
  if (!bridge?.fetchPage) {
    throw new LocalImportError("network", "bridge");
  }
  const res = await bridge.fetchPage(url);
  if (!res || !res.ok) {
    throw new LocalImportError("network", res?.error ?? String(res?.status ?? ""));
  }
  return res.text;
}

function translateImportError(err: unknown): LocalImportError {
  if (err instanceof LocalImportError) return err;
  return new LocalImportError("network", String((err as Error)?.message ?? err));
}

export const useImportStore = create<ActiveImportState>((set, get) => ({
  job: null,
  isPolling: false,
  mode: null,
  error: null,
  pendingTrack: null,
  reviewItems: null,
  approvedTracks: null,

  reset: () => {
    cleanupActiveConnections();
    set({
      job: null,
      isPolling: false,
      mode: null,
      error: null,
      pendingTrack: null,
      reviewItems: null,
      approvedTracks: null,
    });
  },

  cancelPolling: () => {
    cleanupActiveConnections();
    set({ isPolling: false });
  },

  startImport: async (url: string, pendingTrack: TrackDetail | null = null) => {
    get().cancelPolling();
    cleanupActiveConnections();
    set({
      mode: "local",
      error: null,
      isPolling: true,
      pendingTrack,
      reviewItems: null,
      approvedTracks: null,
      job: null,
    });

    const source = detectImportSource(url);
    try {
      let tracks: SourceTrackSeed[] = [];
      let parsedTitle: string | undefined;
      let parsedDescription: string | undefined;

      if (source === "soundcloud") {
        const apiResult = await resolveSoundCloudPlaylist(url);
        if (apiResult.ok && apiResult.playlist.tracks.length > 0) {
          tracks = apiResult.playlist.tracks.map(soundCloudTrackToSeed);
          parsedTitle = apiResult.playlist.title;
        }
      }

      if (tracks.length === 0) {
        const html = await fetchImportedPage(url);
        const parsed = parsePageForKind(source, html, url);
        parsedTitle = parsed.title;
        parsedDescription = parsed.description;
        tracks = parsed.tracks;
      }

      return await get().importLocalSeeds(tracks, {
        source: source as ImportJob["source"],
        sourceUrl: url,
        title: parsedTitle,
        description: parsedDescription,
      });
    } catch (err) {
      const localErr = translateImportError(err);
      const message = localErrorMessage(localErr.code, source);
      set({ isPolling: false, error: message, mode: "local" });
      throw new LocalImportError(localErr.code, message);
    }
  },

  importLocalSeeds: async (tracks, opts) => {
    const seeds = tracks.filter((track) => Boolean(track.title && track.title.trim()));
    if (seeds.length === 0) {
      const msg = localErrorMessage("no_tracks", opts?.source ?? "unknown");
      set({ isPolling: false, error: msg, mode: "local" });
      throw new LocalImportError("no_tracks", msg);
    }

    const reviewItems = await matchSeedsToCatalog(seeds);

    const approvedTracks = reviewItems
      .filter((item) => item.reason === "auto_matched" && Boolean(item.proposedTrack))
      .map((item) => item.proposedTrack);

    const job: ImportJob = {
      id: `local-import-${Date.now()}`,
      source: (opts?.source ?? "youtube") as ImportJob["source"],
      sourceUrl: opts?.sourceUrl ?? "",
      title: opts?.title,
      description: opts?.description,
      status: "awaiting_decision",
      requiresDecision: true,
      createdAt: new Date().toISOString(),
    };

    set({ job, isPolling: false, reviewItems, approvedTracks, mode: "local" });
    useModalStore.getState().openImportReview(job.id, reviewItems, approvedTracks);
    return job;
  },

  listenToWebSocketWorker: (job: ImportJob) => {
    cleanupActiveConnections();
    set({ isPolling: true });

    let isFinished = false;
    let ws: WebSocket;

    try {
      const wsUrl = new URL(job.workerWsUrl!);
      wsUrl.searchParams.set("token", job.importToken!);
      const protocol = wsUrl.protocol === "https:" ? "wss:" : wsUrl.protocol === "http:" ? "ws:" : wsUrl.protocol;
      const targetUrl = `${protocol}//${wsUrl.host}${wsUrl.pathname}${wsUrl.search}`;

      ws = new WebSocket(targetUrl);
      activeWebSocket = ws;
    } catch {
      set({ error: "Failed to connect to import service", isPolling: false });
      cleanupActiveConnections();
      return;
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "job") {
          const current: ImportJob = {
            id: msg.id || job.id,
            source: msg.source || job.source,
            sourceUrl: msg.sourceUrl || job.sourceUrl,
            title: msg.title || job.title,
            description: msg.description || job.description,
            status: msg.status,
            queuePosition: typeof msg.queuePosition === "number" ? msg.queuePosition : undefined,
            requiresDecision: Boolean(msg.requiresDecision),
            playlistId: msg.playlistId,
            result: msg.result,
            error: msg.error,
            createdAt: msg.createdAt || job.createdAt,
          };

          const reviewItems =
            Array.isArray(msg.reviewItems) && msg.reviewItems.length > 0
              ? msg.reviewItems
              : get().reviewItems;
          const approvedTracks =
            Array.isArray(msg.approvedTracks) && msg.approvedTracks.length > 0
              ? msg.approvedTracks
              : get().approvedTracks;

          set({ job: current, reviewItems, approvedTracks });

          if (reviewItems && reviewItems.length > 0) {
            useModalStore.setState({
              importReviewPrefetched: reviewItems,
              importReviewApprovedTracks: approvedTracks,
            });
          }

          if (current.status === "awaiting_decision") {
            isFinished = true;
            set({ isPolling: false, job: current, reviewItems, approvedTracks });
            cleanupActiveConnections();
            useModalStore
              .getState()
              .openImportReview(current.id, reviewItems ?? undefined, approvedTracks ?? undefined);
            return;
          }

          if (current.status === "completed") {
            isFinished = true;
            cleanupActiveConnections();

            // sync final playlist id from backend if created asynchronously via redis
            if (!current.playlistId) {
              void (async () => {
                for (let i = 0; i < 5; i++) {
                  try {
                    const synced = await api.getPlaylistImport(job.id);
                    if (synced.playlistId || synced.status === "completed") {
                      set({ isPolling: false, job: synced });
                      notifyLibraryChanged();
                      return;
                    }
                  } catch {}
                  await new Promise((r) => setTimeout(r, 600));
                }
                set({ isPolling: false, job: current });
                notifyLibraryChanged();
              })();
            } else {
              set({ isPolling: false, job: current });
              notifyLibraryChanged();
            }
            return;
          }

          if (current.status === "failed") {
            isFinished = true;
            set({ isPolling: false, job: current, error: current.error?.message || "Import failed" });
            cleanupActiveConnections();
            return;
          }
        }
      } catch {}
    };

    ws.onerror = () => {
      if (isFinished) return;
      cleanupActiveConnections();
      set((prev) => ({
        isPolling: false,
        error: "Import service connection error",
        job: prev.job ? { ...prev.job, status: "failed", error: { code: "CONNECTION_ERROR", message: "Import service connection error" } } : null,
      }));
    };

    ws.onclose = () => {
      if (isFinished) return;
      cleanupActiveConnections();
      set((prev) => ({
        isPolling: false,
        error: "Import service disconnected",
        job: prev.job ? { ...prev.job, status: "failed", error: { code: "DISCONNECTED", message: "Import service disconnected" } } : null,
      }));
    };
  },

  pollJob: async (jobId: string) => {
    if (pollTimer) clearTimeout(pollTimer);

    try {
      const current = await api.getPlaylistImport(jobId);
      set({ job: current });

      if (current.status === "awaiting_decision") {
        set({ isPolling: false, job: current });
        return;
      }

      if (current.status === "completed") {
        set({ isPolling: false, job: current });
        notifyLibraryChanged();
        return;
      }

      if (current.status === "failed") {
        set({ isPolling: false, job: current, error: "Import failed" });
        return;
      }

      pollTimer = setTimeout(() => {
        void get().pollJob(jobId);
      }, 1000);
    } catch {
      pollTimer = setTimeout(() => {
        void get().pollJob(jobId);
      }, 2500);
    }
  },
}));

let lastHandledCompletedJobId: string | null = null;

useImportStore.subscribe((state) => {
  const { job, pendingTrack } = state;
  if (!job || job.status !== "completed" || !job.playlistId || !pendingTrack) return;
  if (job.id === lastHandledCompletedJobId) return;
  lastHandledCompletedJobId = job.id;

  useImportStore.setState({ pendingTrack: null });

  void (async () => {
    const translate = createTranslatorSync(getStoredLocale());
    try {
      await api.addPlaylistTrack(job.playlistId as string, pendingTrack.id);
      notifyLibraryChanged();
      showToast(translate("common.added_to_playlist"), "checkmark", {
        description: pendingTrack.title || undefined,
      });
    } catch {
      showToast(translate("common.failed_add_playlist"), "error");
    }
  })();
});
