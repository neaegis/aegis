import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/features/player";
import {
  useDiscordRpcStore,
  type DiscordAssetKey,
} from "@/features/settings/store/discordStore";
import { buildShareUrl } from "@/shared/utils/share";
import { useTranslation } from "@/languages";

const REFRESH_INTERVAL_MS = 15_000;

// Mirrors the presence sent to Discord via the main-process IPC socket:
// cover as large image, then track / artist while playing, plus a
// "Listen in Aegis" button pointing back at the share redirector.
export function useDiscordRichPresence(): void {
  const trackId = usePlayerStore((state) => state.currentTrack?.id ?? null);
  const status = usePlayerStore((state) => state.status);
  const playbackContext = usePlayerStore((state) => state.playbackContext);
  const rpcEnabled = useDiscordRpcStore((state) => state.enabled);
  const rpcLargeImage = useDiscordRpcStore((state) => state.largeImage);
  const rpcSmallImage = useDiscordRpcStore((state) => state.smallImage);
  const { t } = useTranslation();

  const snapshotRef = useRef<{
    trackId: string | null;
    status: string;
    playbackContext: string | null;
    label: string;
    rpc: string;
  } | null>(null);

  useEffect(() => {
    const send = () => {
      if (!window.aegisElectron?.setDiscordActivity) return;

      const store = usePlayerStore.getState();
      const track = store.currentTrack;
      if (!track || !track.id || !track.title || !track.artists) {
        void window.aegisElectron.clearDiscordActivity?.();
        snapshotRef.current = null;
        return;
      }

      const rpc = useDiscordRpcStore.getState();
      if (!rpc.enabled) {
        void window.aegisElectron.clearDiscordActivity?.();
        return;
      }

      const label = t("settings.discord.listen_button") || "Listen in Aegis";
      const playing = store.status === "playing";
      const start = playing ? Date.now() - store.positionMs : undefined;
      const duration = store.durationMs || track.durationMs || 0;
      const end = playing && duration > 0 ? start! + duration : undefined;

      const assetKey = (asset: DiscordAssetKey): string =>
        asset === "cover" ? "aegis_cover" : "aegis_logo";
      const usableCover = track.coverUrl ? track.coverUrl : undefined;
      const largeFallback = assetKey(rpc.largeImage);
      const smallFallback = assetKey(rpc.smallImage);

      void window.aegisElectron.setDiscordActivity({
        details: track.title,
        state: track.artists,
        startTimestamp: start,
        endTimestamp: end,
        largeImage: rpc.largeImage === "cover" ? usableCover ?? largeFallback : largeFallback,
        largeText: t("settings.discord.large_text") || "Aegis",
        smallImage: rpc.smallImage === "cover" ? usableCover ?? smallFallback : smallFallback,
        smallText: rpc.smallImage === "cover" ? track.title : "Aegis",
        buttonLabel: label,
        buttonUrl: buildShareUrl("track", track.id),
      });

      snapshotRef.current = {
        trackId: track.id,
        status: store.status,
        playbackContext,
        label,
        rpc: `${rpc.enabled}|${rpc.largeImage}|${rpc.smallImage}`,
      };
    };

    const rpcConfig = `${rpcEnabled}|${rpcLargeImage}|${rpcSmallImage}`;
    const nextSnapshot = {
      trackId,
      status,
      playbackContext,
      label: t("settings.discord.listen_button"),
      rpc: rpcConfig,
    };

    const changed =
      snapshotRef.current?.trackId !== nextSnapshot.trackId ||
      snapshotRef.current?.status !== nextSnapshot.status ||
      snapshotRef.current?.playbackContext !== nextSnapshot.playbackContext ||
      snapshotRef.current?.label !== nextSnapshot.label ||
      snapshotRef.current?.rpc !== nextSnapshot.rpc;

    if (changed) {
      send();
    }

    if (status === "playing" && trackId && rpcEnabled) {
      const timer = setInterval(send, REFRESH_INTERVAL_MS);
      return () => clearInterval(timer);
    }
  }, [trackId, status, playbackContext, rpcEnabled, rpcLargeImage, rpcSmallImage, t]);
}

export function DiscordPresenceSync(): null {
  useDiscordRichPresence();
  return null;
}