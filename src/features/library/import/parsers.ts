export type ImportSourceKind =
  | "youtube"
  | "soundcloud"
  | "spotify"
  | "vk"
  | "yandex"
  | "deezer"
  | "apple_music"
  | "unknown";

export type LocalImportErrorCode =
  | "network"
  | "unsupported_source"
  | "spotify_unavailable"
  | "no_tracks";

export class LocalImportError extends Error {
  readonly code: LocalImportErrorCode;
  constructor(code: LocalImportErrorCode, message: string) {
    super(message);
    this.name = "LocalImportError";
    this.code = code;
  }
}

export interface SourceTrackSeed {
  sourceId: string;
  title: string;
  artists: string[];
  durationMs?: number;
  coverUrl?: string;
}

export interface ParsedSource {
  source: ImportSourceKind;
  title?: string;
  description?: string;
  tracks: SourceTrackSeed[];
}

export function detectImportSource(raw: string): ImportSourceKind {
  let text = raw.trim();
  if (!/^https?:\/\//i.test(text)) {
    text = `https://${text}`;
  }
  let host: string;
  try {
    host = new URL(text).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "unknown";
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com") ||
    host.endsWith(".youtu.be")
  ) {
    return "youtube";
  }
  if (host === "soundcloud.com" || host.endsWith(".soundcloud.com")) {
    return "soundcloud";
  }
  if (host === "open.spotify.com" || host === "play.spotify.com" || host.endsWith(".spotify.com")) {
    return "spotify";
  }
  if (host === "vk.com" || host === "m.vk.com" || host === "vk.cc" || host === "vkvideo.ru") {
    return "vk";
  }
  if (
    host === "music.yandex.ru" ||
    host === "music.yandex.com" ||
    host === "yandex.ru" ||
    host === "yandex.com" ||
    host.endsWith(".yandex.ru")
  ) {
    return "yandex";
  }
  if (host === "deezer.com" || host.endsWith(".deezer.com")) {
    return "deezer";
  }
  if (
    host === "music.apple.com" ||
    host === "itunes.apple.com" ||
    host === "geo.music.apple.com" ||
    host.endsWith(".music.apple.com")
  ) {
    return "apple_music";
  }
  return "unknown";
}

function findBalancedEnd(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (inDouble || inSingle) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function extractScriptJson(text: string, marker: string): unknown | null {
  const markIdx = text.indexOf(marker);
  if (markIdx === -1) return null;
  let open = -1;
  for (let i = markIdx + marker.length; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{" || ch === "[") {
      open = i;
      break;
    }
    if (i - (markIdx + marker.length) > 400) break;
  }
  if (open === -1) return null;
  const end = findBalancedEnd(text, open);
  if (end === -1) return null;
  try {
    return JSON.parse(text.slice(open, end));
  } catch {
    return null;
  }
}

function deepFindAll(
  root: unknown,
  pred: (value: any) => boolean,
  limit = 10000,
): any[] {
  const out: any[] = [];
  const queue: unknown[] = [root];
  let qi = 0;
  while (qi < queue.length && out.length < limit) {
    const current = queue[qi];
    qi += 1;
    if (current === null || current === undefined) continue;
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (typeof current === "object") {
      if (pred(current)) {
        out.push(current);
        continue;
      }
      for (const value of Object.values(current)) {
        if (typeof value === "object") queue.push(value);
      }
    }
  }
  return out;
}

interface YtPlaylistVideo {
  videoId: string;
  title: string;
  artists: string[];
  durationMs?: number;
  coverUrl?: string;
}

function parseDurationText(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!/^\d*(:?\d{1,2})?/.test(trimmed)) return undefined;
  const parts = trimmed.split(":").map((p) => Number(p.trim()));
  if (parts.some((p) => Number.isNaN(p))) return undefined;
  if (parts.length === 3) {
    return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000;
  }
  if (parts.length === 2) {
    return ((parts[0] || 0) * 60 + parts[1]) * 1000;
  }
  if (parts.length === 1) {
    return parts[0] * 1000;
  }
  return undefined;
}

function runsToText(runs: unknown, join = ""): string {
  if (!Array.isArray(runs)) return "";
  return runs
    .map((run: any) => {
      if (run && typeof run === "object" && typeof run.text === "string") return run.text;
      return "";
    })
    .join(join)
    .trim();
}

function lastThumbnailUrl(thumbnail: unknown): string | undefined {
  const thumbs: any[] =
    thumbnail && Array.isArray((thumbnail as any).thumbnails) ? (thumbnail as any).thumbnails : [];
  const last = thumbs[thumbs.length - 1];
  return last && typeof last.url === "string" ? last.url : undefined;
}

function extractPlaylistVideos(data: unknown): { title?: string; videos: YtPlaylistVideo[] } {
  const header = deepFindAll(data, (v: any) => v && typeof v === "object" && v.playlistHeaderRenderer, 20)[0];
  const metadata = deepFindAll(data, (v: any) => v && typeof v === "object" && v.playlistMetadataRenderer, 20)[0];
  const title =
    header?.playlistHeaderRenderer?.title && typeof header.playlistHeaderRenderer.title === "object"
      ? runsToText(header.playlistHeaderRenderer.title.runs, "")
      : metadata?.playlistMetadataRenderer?.title ?? undefined;

  const videos: YtPlaylistVideo[] = [];

  const playlistVideos = deepFindAll(
    data,
    (v: any) => v && typeof v === "object" && typeof v.playlistVideoRenderer === "object",
  );
  for (const item of playlistVideos) {
    const r = item.playlistVideoRenderer as any;
    const videoId = r.videoId as string | undefined;
    const videoTitle = runsToText(r.title?.runs, "");
    if (!videoId || !videoTitle) continue;
    const byline = r.longBylineText || r.shortBylineText;
    const artists = runsToText(byline?.runs, ", ")
      .split(/[,·]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    videos.push({
      videoId,
      title: videoTitle,
      artists: artists.length > 0 ? artists : ["YouTube"],
      durationMs: parseDurationText(r.lengthText?.simpleText ?? r.lengthText?.runs?.[0]?.text),
      coverUrl: lastThumbnailUrl(r.thumbnail ?? (r as any).thumbnailRenderer),
    });
  }

  const musicItems = deepFindAll(
    data,
    (v: any) => v && typeof v === "object" && typeof v.musicResponsiveListItemRenderer === "object",
  );
  for (const item of musicItems) {
    const r = item.musicResponsiveListItemRenderer as any;
    if (!r.flexColumns || !Array.isArray(r.flexColumns)) continue;
    const first = r.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const second = r.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const title = runsToText(first, "");
    if (!title) continue;
    const artistText = runsToText(second, ", ");
    let artists = artistText
      .split(/[,·]+/)
      .map((a) => a.trim())
      .filter(Boolean);
    const duration =
      r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.map((run: any) => run.text ?? "").join("") ?? "";
    videos.push({
      videoId: `music:${title}`,
      title,
      artists: artists.length > 0 ? artists : ["YouTube"],
      durationMs: parseDurationText(duration),
      coverUrl: lastThumbnailUrl(r.thumbnail?.musicThumbnailRenderer),
    });
  }

  return { title, videos };
}

export function parseYouTubePage(html: string, _sourceUrl: string): ParsedSource {
  const data = extractScriptJson(html, "ytInitialData");
  if (data) {
    const { title, videos } = extractPlaylistVideos(data);
    if (videos.length > 0) {
      return { source: "youtube", title, tracks: toSeeds(videos, "yt") };
    }
  }

  const player = extractScriptJson(html, "ytInitialPlayerResponse");
  if (player && typeof player === "object") {
    const details: any = (player as any).videoDetails;
    if (details && typeof details.title === "string" && typeof details.videoId === "string") {
      const lengthSeconds = Number(details.lengthSeconds);
      return {
        source: "youtube",
        title: details.title,
        tracks: [
          {
            sourceId: `yt:${details.videoId}`,
            title: details.title,
            artists: details.author ? [details.author] : ["YouTube"],
            durationMs: Number.isFinite(lengthSeconds) && lengthSeconds > 0 ? lengthSeconds * 1000 : undefined,
            coverUrl: lastThumbnailUrl(details.thumbnail),
          },
        ],
      };
    }
  }

  throw new LocalImportError("no_tracks", "youtube");
}

function toSeeds(videos: YtPlaylistVideo[], prefix: string): SourceTrackSeed[] {
  return videos.map((v) => ({
    sourceId: `${prefix}:${v.videoId}`,
    title: v.title,
    artists: v.artists,
    durationMs: v.durationMs,
    coverUrl: v.coverUrl,
  }));
}

interface ScTrack {
  id: string;
  title: string;
  artists: string[];
  durationMs?: number;
  coverUrl?: string;
}

export function parseSoundCloudPage(html: string): ParsedSource {
  const hydration = extractScriptJson(html, "__sc_hydration");
  if (!hydration) {
    throw new LocalImportError("no_tracks", "soundcloud");
  }
  const tracks: ScTrack[] = [];
  const seen = new Set<string>();
  const entities = deepFindAll(hydration, (v: any) => v && typeof v === "object" && v.kind === "track");
  for (const entity of entities) {
    const id = entity.id != null ? String(entity.id) : "";
    const title = typeof entity.title === "string" ? entity.title : "";
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const username: string | undefined = entity.user?.username;
    tracks.push({
      id,
      title,
      artists: username ? [username] : [],
      durationMs: typeof entity.duration === "number" ? entity.duration : undefined,
      coverUrl: typeof entity.artwork_url === "string" ? entity.artwork_url.replace("large", "t500x500") : undefined,
    });
  }
  if (tracks.length === 0) {
    throw new LocalImportError("no_tracks", "soundcloud");
  }
  return {
    source: "soundcloud",
    tracks: tracks.map((t) => ({
      sourceId: `sc:${t.id}`,
      title: t.title,
      artists: t.artists.length > 0 ? t.artists : ["SoundCloud"],
      durationMs: t.durationMs,
      coverUrl: t.coverUrl,
    })),
  };
}

interface SpotifyItem {
  name: string;
  artists: string[];
  durationMs?: number;
  uri?: string;
}

export function parseSpotifyPage(html: string): ParsedSource {
  const nextData = extractScriptJson(html, "__NEXT_DATA__");
  if (nextData) {
    const items = deepFindAll(
      nextData,
      (v: any) =>
        v &&
        typeof v === "object" &&
        typeof v.name === "string" &&
        Array.isArray(v.artists) &&
        (typeof v.uri === "string" ? v.uri.startsWith("spotify:track:") : true) &&
        !Array.isArray(v.items),
    );
    const tracks: SpotifyItem[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const uri = typeof item.uri === "string" ? item.uri : "";
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      tracks.push({
        name: item.name,
        artists: item.artists
          .map((a: any) => (typeof a?.name === "string" ? a.name : ""))
          .filter(Boolean),
        durationMs: typeof item.duration_ms === "number" ? item.duration_ms : undefined,
        uri,
      });
    }
    if (tracks.length > 0) {
      return {
        source: "spotify",
        tracks: tracks.map((t) => ({
          sourceId: `sp:${t.uri}`,
          title: t.name,
          artists: t.artists.length > 0 ? t.artists : ["Spotify"],
          durationMs: t.durationMs,
        })),
      };
    }
  }
  throw new LocalImportError("spotify_unavailable", "spotify");
}

export function parsePageForKind(
  kind: ImportSourceKind,
  html: string,
  sourceUrl: string,
): ParsedSource {
  switch (kind) {
    case "youtube":
      return parseYouTubePage(html, sourceUrl);
    case "soundcloud":
      return parseSoundCloudPage(html);
    case "spotify":
      return parseSpotifyPage(html);
    default:
      throw new LocalImportError("unsupported_source", kind);
  }
}