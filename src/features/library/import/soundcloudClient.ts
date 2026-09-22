import type { SourceTrackSeed } from "./parsers";

export interface SoundCloudTrackDto {
  sourceId: string;
  title: string;
  artists: string[];
  durationMs?: number;
  coverUrl?: string;
  permalinkUrl?: string;
}

export interface SoundCloudPlaylistDto {
  id: string;
  title?: string;
  permalinkUrl?: string;
  tracks: SoundCloudTrackDto[];
}

export type SoundCloudErrorCode =
  | "network"
  | "no_client_id"
  | "invalid_url"
  | "not_found"
  | "denied"
  | "not_a_playlist"
  | "empty";

export type SoundCloudResolveResult =
  | { ok: true; playlist: SoundCloudPlaylistDto }
  | { ok: false; code: SoundCloudErrorCode; message: string };

export type SoundCloudTrendingResult =
  | { ok: true; tracks: SoundCloudTrackDto[] }
  | { ok: false; code: SoundCloudErrorCode; message: string };

interface SoundCloudBridge {
  resolveSoundCloudPlaylist?: (url: string) => Promise<SoundCloudResolveResult>;
  getSoundCloudTrending?: (limit?: number) => Promise<SoundCloudTrendingResult>;
}

function bridge(): SoundCloudBridge {
  return (window as unknown as { aegisElectron?: SoundCloudBridge }).aegisElectron ?? {};
}

export async function resolveSoundCloudPlaylist(
  url: string,
): Promise<SoundCloudResolveResult> {
  const b = bridge();
  if (!b.resolveSoundCloudPlaylist) {
    return { ok: false, code: "network", message: "bridge not available" };
  }
  try {
    return await b.resolveSoundCloudPlaylist(url);
  } catch (err) {
    return { ok: false, code: "network", message: (err as Error)?.message ?? "soundcloud error" };
  }
}

export async function getSoundCloudTrending(
  limit = 15,
): Promise<SoundCloudTrendingResult> {
  const b = bridge();
  if (!b.getSoundCloudTrending) {
    return { ok: false, code: "network", message: "bridge not available" };
  }
  try {
    return await b.getSoundCloudTrending(limit);
  } catch (err) {
    return { ok: false, code: "network", message: (err as Error)?.message ?? "soundcloud error" };
  }
}

export function soundCloudTrackToSeed(track: SoundCloudTrackDto): SourceTrackSeed {
  return {
    sourceId: track.sourceId,
    title: track.title,
    artists: track.artists,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
  };
}