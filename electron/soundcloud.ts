const SOUNDCLOUD_PAGE_HOSTS = new Set(["soundcloud.com", "m.soundcloud.com"]);
const SOUNDCLOUD_API_HOST = "api-v2.soundcloud.com";
const SOUNDCLOUD_CDN_REGEX = /^https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/;
const API_BASE = "https://api-v2.soundcloud.com";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

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

export type SoundCloudResolveResult =
  | { ok: true; playlist: SoundCloudPlaylistDto }
  | { ok: false; code: SoundCloudErrorCode; message: string };

export type SoundCloudTrendingResult =
  | { ok: true; tracks: SoundCloudTrackDto[] }
  | { ok: false; code: SoundCloudErrorCode; message: string };

export type SoundCloudErrorCode =
  | "network"
  | "no_client_id"
  | "invalid_url"
  | "not_found"
  | "denied"
  | "not_a_playlist"
  | "empty";

class SoundCloudApiError extends Error {
  readonly code: SoundCloudErrorCode;
  constructor(code: SoundCloudErrorCode, message: string) {
    super(message);
    this.name = "SoundCloudApiError";
    this.code = code;
  }
}

function isAllowedFetchUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (SOUNDCLOUD_API_HOST === host || host.endsWith("." + SOUNDCLOUD_API_HOST)) return true;
  if (SOUNDCLOUD_PAGE_HOSTS.has(host) || host.endsWith(".soundcloud.com")) return true;
  if (SOUNDCLOUD_CDN_REGEX.test(url)) return true;
  return false;
}

async function fetchText(url: string, timeoutMs = 20000, maxBytes = 12 * 1024 * 1024): Promise<string> {
  if (!isAllowedFetchUrl(url)) throw new SoundCloudApiError("invalid_url", "host not allowed");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "application/json,text/html,application/javascript;q=0.9,*/*;q=0.8",
      },
    });
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > maxBytes) throw new SoundCloudApiError("network", "response too large");
    return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
  } catch (err) {
    if (err instanceof SoundCloudApiError) throw err;
    throw new SoundCloudApiError("network", (err as Error)?.message ?? "fetch failed");
  } finally {
    clearTimeout(timer);
  }
}

function extractClientIdFromJs(js: string): string | undefined {
  const match = js.match(/client_id\s*[=:]\s*["']([A-Za-z0-9]{20,})["']/);
  return match ? match[1] : undefined;
}

export function parseSoundCloudClientId(js: string): string | undefined {
  return extractClientIdFromJs(js);
}

let cachedClientId: string | null = null;

async function fetchClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  const html = await fetchText("https://soundcloud.com/");
  const chunkUrls = Array.from(
    new Set(
      Array.from(html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)).map(
        (m) => m[1],
      ),
    ),
  ).slice(0, 30);
  for (const chunkUrl of chunkUrls) {
    try {
      const js = await fetchText(chunkUrl);
      const cid = extractClientIdFromJs(js);
      if (cid) {
        cachedClientId = cid;
        return cid;
      }
    } catch {
      // keep scanning other chunks
    }
  }
  throw new SoundCloudApiError("no_client_id", "could not obtain SoundCloud client id");
}

async function apiGet(pathname: string, params: Record<string, string>): Promise<any> {
  const cid = await fetchClientId();
  const url = new URL(API_BASE + pathname);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("client_id", cid);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": UA,
        "Accept": "application/json,text/javascript;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
  } catch (err) {
    throw new SoundCloudApiError("network", (err as Error)?.message ?? "api fetch failed");
  }
  if (res.status === 404) throw new SoundCloudApiError("not_found", "not found");
  if (res.status === 401 || res.status === 403) throw new SoundCloudApiError("denied", "access denied");
  if (!res.ok) throw new SoundCloudApiError("network", `api error ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new SoundCloudApiError("network", "invalid api response");
  }
}

export function normalizeSoundCloudTrack(raw: any): SoundCloudTrackDto | null {
  if (!raw || typeof raw !== "object") return null;
  const track = raw && typeof raw.track === "object" ? raw.track : raw;
  const id = typeof track.id === "number" || typeof track.id === "string" ? String(track.id) : "";
  const title = typeof track.title === "string" ? track.title.trim() : "";
  if (!id || !title) return null;
  const username =
    track.user && typeof track.user.username === "string" ? track.user.username.trim() : "";
  return {
    sourceId: `sc:${id}`,
    title,
    artists: username ? [username] : ["SoundCloud"],
    durationMs:
      typeof track.duration === "number" && track.duration > 0 ? Math.round(track.duration) : undefined,
    coverUrl: soundCloudArtworkUrl(track.artwork_url) ?? soundCloudArtworkUrl(track.user?.avatar_url),
    permalinkUrl: typeof track.permalink_url === "string" ? track.permalink_url : undefined,
  };
}

export function soundCloudArtworkUrl(url: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined;
  return url.replace("-large", "-t500x500");
}

function dedupeTracks(tracks: SoundCloudTrackDto[]): SoundCloudTrackDto[] {
  const seen = new Set<string>();
  const out: SoundCloudTrackDto[] = [];
  for (const track of tracks) {
    if (seen.has(track.sourceId)) continue;
    seen.add(track.sourceId);
    out.push(track);
  }
  return out;
}

export function isTrackStub(raw: any): boolean {
  if (!raw || typeof raw !== "object") return false;
  const track = raw && typeof raw.track === "object" ? raw.track : raw;
  const id = typeof track.id === "number" || typeof track.id === "string" ? track.id : undefined;
  if (id === undefined) return false;
  return !(typeof track.title === "string" && track.title.length > 0);
}

async function resolveTrackStubs(stubs: any[]): Promise<any[]> {
  const ids = stubs
    .map((s) => (s && typeof s.track === "object" ? s.track : s)?.id)
    .filter((id) => id !== undefined && id !== null)
    .map(String);
  const resolved: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    if (chunk.length === 0) continue;
    try {
      const body = await apiGet("/tracks", { ids: chunk.join(",") });
      if (Array.isArray(body)) resolved.push(...body);
    } catch {
      // keep what we have for this chunk
    }
  }
  return resolved;
}

export async function resolveSoundCloudPlaylist(url: string): Promise<SoundCloudResolveResult> {
  try {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, code: "invalid_url", message: "invalid url" };
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "soundcloud.com" && !host.endsWith(".soundcloud.com")) {
      return { ok: false, code: "invalid_url", message: "not a soundcloud url" };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, code: "invalid_url", message: "invalid protocol" };
    }

    const body = await apiGet("/resolve", { url: parsed.toString() });
    if (!body || body.kind !== "playlist") {
      return { ok: false, code: "not_a_playlist", message: "resolved resource is not a playlist" };
    }

    let rawTracks = Array.isArray(body.tracks)
      ? body.tracks.filter((t: any) => typeof t === "object" && t !== null)
      : [];

    if (rawTracks.some(isTrackStub)) {
      try {
        const merged = [...rawTracks];
        const stubs = rawTracks.filter(isTrackStub);
        const extra = await resolveTrackStubs(stubs);
        const extraById = new Map<string, any>();
        for (const tr of extra) {
          const base = tr && typeof tr.track === "object" ? tr.track : tr;
          if (base && base.id !== undefined) extraById.set(String(base.id), base);
        }
        rawTracks = merged.map((t: any) => {
          if (!isTrackStub(t)) return t;
          const base = t && typeof t.track === "object" ? t.track : t;
          return extraById.get(String(base.id)) ?? t;
        });
      } catch {
        // keep original tracks
      }
    }

    let tracks = rawTracks
      .map((t: any) => normalizeSoundCloudTrack(t))
      .filter((t: any): t is SoundCloudTrackDto => t !== null);
    tracks = dedupeTracks(tracks);

    const trackCount = typeof body.track_count === "number" ? body.track_count : 0;
    if (tracks.length < trackCount) {
      try {
        const full = await apiGet(`/playlists/${String(body.id)}`, {});
        if (full && Array.isArray(full.tracks)) {
          const more = full.tracks
            .map((t: any) => normalizeSoundCloudTrack(t))
            .filter((t: any): t is SoundCloudTrackDto => t !== null);
          if (more.length > tracks.length) tracks = dedupeTracks(more);
        }
      } catch {
        // keep inline tracks
      }
    }

    if (tracks.length === 0) {
      return { ok: false, code: "empty", message: "no tracks found" };
    }

    return {
      ok: true,
      playlist: {
        id: String(body.id ?? ""),
        title: typeof body.title === "string" ? body.title : undefined,
        permalinkUrl: typeof body.permalink_url === "string" ? body.permalink_url : undefined,
        tracks,
      },
    };
  } catch (err) {
    if (err instanceof SoundCloudApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "network", message: (err as Error)?.message ?? "soundcloud error" };
  }
}

export async function soundCloudTrendingTracks(limit = 15): Promise<SoundCloudTrendingResult> {
  try {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 15));
    const body = await apiGet("/charts", {
      kind: "trending",
      genre: "soundcloud:genres:all-music",
      limit: String(safeLimit),
      linked_partitioning: "true",
    });
    const collection = Array.isArray(body?.collection) ? body.collection : [];
    const tracks = dedupeTracks(
      collection
        .map((item: any) => normalizeSoundCloudTrack(item))
        .filter((t: any): t is SoundCloudTrackDto => t !== null),
    );
    if (tracks.length === 0) {
      return { ok: false, code: "empty", message: "no trending tracks" };
    }
    return { ok: true, tracks };
  } catch (err) {
    if (err instanceof SoundCloudApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return { ok: false, code: "network", message: (err as Error)?.message ?? "soundcloud error" };
  }
}